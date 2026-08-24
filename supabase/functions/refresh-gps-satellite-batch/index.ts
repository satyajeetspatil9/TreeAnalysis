import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UPSTREAM_URL = Deno.env.get('GPS_ANALYSIS_UPSTREAM_URL')
  ?? 'https://orchard-planetary-api.onrender.com/api/gps-analysis';

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;
const UPSTREAM_TIMEOUT_MS = 150000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getWeekMonday(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function fetchUpstreamAnalysis(
  treeId: string,
  latitude: number,
  longitude: number,
  daysBack: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tree_id: treeId,
        latitude,
        longitude,
        days_back: daysBack,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      let message = `Upstream failed (${response.status})`;
      try {
        const parsed = JSON.parse(text);
        message = parsed.error || parsed.message || message;
      } catch {
        if (text) message = text;
      }
      throw new Error(message);
    }

    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadStats(admin: ReturnType<typeof createClient>, farmId: number) {
  const { data, error } = await admin.rpc('gps_satellite_cache_stats', { p_farm_id: farmId });
  if (error) throw error;
  const row = data?.[0] ?? {};
  const total = Number(row.total_with_gps ?? 0);
  const cached = Number(row.cached_this_week ?? 0);
  return {
    week_start: row.week_start ?? getWeekMonday(),
    total_with_gps: total,
    cached_this_week: cached,
    remaining: Math.max(0, total - cached),
    done: cached >= total,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server configuration error' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON body required' }, 400);
  }

  const farmId = Number(body.farm_id);
  if (!Number.isFinite(farmId) || farmId <= 0) {
    return json({ error: 'farm_id is required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { data: farmRow, error: farmError } = await userClient
    .from('farms')
    .select('id')
    .eq('id', farmId)
    .maybeSingle();

  if (farmError || !farmRow) {
    return json({ error: 'Farm not found or access denied' }, 403);
  }

  const weekStart = getWeekMonday();
  const daysBack = Number(body.days_back ?? 10);
  const force = Boolean(body.force);
  const statsOnly = Boolean(body.stats_only);
  const afterPositionId = Number(body.after_position_id ?? 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(body.limit ?? DEFAULT_LIMIT)),
  );

  try {
    if (statsOnly) {
      const stats = await loadStats(admin, farmId);
      return json(stats);
    }

    const { data: positions, error: posError } = await admin.rpc(
      'gps_satellite_positions_to_refresh',
      {
        p_farm_id: farmId,
        p_after_position_id: afterPositionId,
        p_limit: limit,
        p_force: force,
      },
    );

    if (posError) {
      return json({ error: posError.message }, 500);
    }

    const queue = positions ?? [];

    if (!queue.length) {
      const stats = await loadStats(admin, farmId);
      return json({
        ...stats,
        processed: [],
        processed_count: 0,
        next_after_position_id: afterPositionId,
      });
    }

    const processed: Array<Record<string, unknown>> = [];
    let lastId = afterPositionId;

    for (const row of queue) {
      lastId = Number(row.position_id);
      const positionCode = String(row.position_code);
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);

      let analysis: Record<string, unknown> | null = null;
      let errorMessage: string | null = null;

      try {
        analysis = await fetchUpstreamAnalysis(
          positionCode,
          latitude,
          longitude,
          daysBack,
        );
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : 'Upstream failed';
      }

      const { error: upsertError } = await admin
        .from('tree_gps_satellite_cache')
        .upsert({
          position_id: lastId,
          position_code: positionCode,
          farm_id: farmId,
          week_start: weekStart,
          fetched_at: new Date().toISOString(),
          latitude,
          longitude,
          analysis,
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        });

      processed.push({
        position_id: lastId,
        position_code: positionCode,
        ok: !upsertError && !errorMessage,
        error: upsertError?.message || errorMessage,
      });
    }

    const stats = await loadStats(admin, farmId);
    return json({
      ...stats,
      processed,
      processed_count: processed.length,
      next_after_position_id: lastId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch refresh failed';
    return json({ error: message }, 500);
  }
});
