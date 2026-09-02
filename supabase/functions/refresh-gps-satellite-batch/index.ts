import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UPSTREAM_URL = Deno.env.get('GPS_ANALYSIS_UPSTREAM_URL')
  ?? 'https://orchard-planetary-api.onrender.com/api/gps-analysis';

const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 3;
const UPSTREAM_TIMEOUT_MS = 150000;
const RADAR_LOOKBACK_DAYS = 28;

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function isFiniteNumber(value: unknown) {
  if (value == null || value === '') return false;
  return Number.isFinite(Number(value));
}

function hasRadarNumericValues(analysis: Record<string, unknown> | null) {
  if (!analysis) return false;
  const indices = asRecord(analysis.indices);
  const s1 = asRecord(asRecord(analysis.selected_images).sentinel1);
  return isFiniteNumber(indices.S1_VV) || isFiniteNumber(s1.vv_db);
}

function isRadarStatusNoData(analysis: Record<string, unknown> | null) {
  if (!analysis) return true;
  const radarStress = asRecord(analysis.radar_stress);
  const indexStatus = asRecord(analysis.index_status);
  const status = String(radarStress.status ?? indexStatus.S1_VV ?? '').trim().toLowerCase();
  return !status || status === 'no data' || status === 'nodata' || status.includes('no data');
}

function isRadarUsable(analysis: Record<string, unknown> | null) {
  return hasRadarNumericValues(analysis) && !isRadarStatusNoData(analysis);
}

function extractRadarSlice(analysis: Record<string, unknown>) {
  const indexStatus = asRecord(analysis.index_status);
  const indices = asRecord(analysis.indices);
  const images = asRecord(analysis.selected_images);
  return {
    radar_stress: analysis.radar_stress ?? null,
    index_status: { S1_VV: indexStatus.S1_VV ?? null },
    indices: { S1_VV: indices.S1_VV ?? null },
    selected_images: { sentinel1: images.sentinel1 ?? null },
    period: analysis.period ?? null,
  };
}

function radarObservationDate(
  analysis: Record<string, unknown> | null,
  storedWeek: string | null = null,
) {
  const s1 = asRecord(asRecord(analysis?.selected_images).sentinel1);
  const s1Date = typeof s1.date === 'string' ? s1.date.slice(0, 10) : null;
  const period = asRecord(analysis?.period);
  const periodEnd = typeof period.end === 'string' ? period.end.slice(0, 10) : null;
  const periodStart = typeof period.start === 'string' ? period.start.slice(0, 10) : null;
  return storedWeek || s1Date || periodEnd || periodStart || null;
}

async function resolveLastGoodRadar(
  analysis: Record<string, unknown> | null,
  existingLastGood: unknown,
  existingWeek: string | null,
  positionCode: string,
  latitude: number,
  longitude: number,
  weekStart: string,
  daysBack: number,
) {
  const existing = existingLastGood && typeof existingLastGood === 'object'
    ? existingLastGood as Record<string, unknown>
    : null;
  let lastGoodRadar: Record<string, unknown> | null = existing;
  let lastGoodRadarWeek = existingWeek;

  if (isRadarUsable(analysis)) {
    return {
      lastGoodRadar: extractRadarSlice(analysis as Record<string, unknown>),
      lastGoodRadarWeek: radarObservationDate(analysis, weekStart),
    };
  }

  if (hasRadarNumericValues(analysis) && !hasRadarNumericValues(lastGoodRadar)) {
    lastGoodRadar = extractRadarSlice(analysis as Record<string, unknown>);
    lastGoodRadarWeek = radarObservationDate(analysis, existingWeek);
  }

  if (hasRadarNumericValues(lastGoodRadar)) {
    return { lastGoodRadar, lastGoodRadarWeek };
  }

  try {
    const older = await fetchUpstreamAnalysis(
      positionCode,
      latitude,
      longitude,
      Math.max(daysBack, RADAR_LOOKBACK_DAYS),
    );
    if (hasRadarNumericValues(older)) {
      return {
        lastGoodRadar: extractRadarSlice(older),
        lastGoodRadarWeek: radarObservationDate(older, null),
      };
    }
  } catch {
    /* keep existing empty last-good */
  }

  return { lastGoodRadar, lastGoodRadarWeek };
}

async function backfillMissingLastGoodRadar(
  admin: ReturnType<typeof createClient>,
  farmId: number,
  weekStart: string,
  limit: number,
  daysBack: number,
) {
  const { data: rows } = await admin
    .from('tree_gps_satellite_cache')
    .select('position_id, position_code, latitude, longitude, analysis, last_good_radar, last_good_radar_week')
    .eq('farm_id', farmId)
    .eq('week_start', weekStart)
    .is('last_good_radar', null)
    .not('analysis', 'is', null)
    .order('position_id', { ascending: true })
    .limit(limit);

  const processed: Array<Record<string, unknown>> = [];

  for (const row of rows ?? []) {
    const analysis = row.analysis && typeof row.analysis === 'object'
      ? row.analysis as Record<string, unknown>
      : null;
    const resolved = await resolveLastGoodRadar(
      analysis,
      row.last_good_radar,
      row.last_good_radar_week ?? null,
      String(row.position_code),
      Number(row.latitude),
      Number(row.longitude),
      weekStart,
      daysBack,
    );

    const { error } = await admin
      .from('tree_gps_satellite_cache')
      .update({
        last_good_radar: resolved.lastGoodRadar,
        last_good_radar_week: resolved.lastGoodRadarWeek,
        updated_at: new Date().toISOString(),
      })
      .eq('position_id', row.position_id);

    processed.push({
      position_id: row.position_id,
      position_code: row.position_code,
      ok: !error && hasRadarNumericValues(resolved.lastGoodRadar),
      error: error?.message || null,
      radar_backfill: true,
    });
  }

  return processed;
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

  const cronSecret = Deno.env.get('GPS_SATELLITE_CRON_SECRET') ?? '';
  const requestCronSecret = req.headers.get('x-cron-secret') ?? '';
  const isCronAuth = Boolean(cronSecret)
    && requestCronSecret.length > 0
    && requestCronSecret === cronSecret;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  if (!isCronAuth) {
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
      const backfilled = await backfillMissingLastGoodRadar(
        admin,
        farmId,
        weekStart,
        limit,
        daysBack,
      );
      const stats = await loadStats(admin, farmId);
      return json({
        ...stats,
        processed: backfilled,
        processed_count: backfilled.length,
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

      const { data: existing } = await admin
        .from('tree_gps_satellite_cache')
        .select('last_good_radar, last_good_radar_week')
        .eq('position_id', lastId)
        .maybeSingle();

      const resolvedRadar = await resolveLastGoodRadar(
        analysis,
        existing?.last_good_radar ?? null,
        existing?.last_good_radar_week ?? null,
        positionCode,
        latitude,
        longitude,
        weekStart,
        daysBack,
      );
      const lastGoodRadar = resolvedRadar.lastGoodRadar;
      const lastGoodRadarWeek = resolvedRadar.lastGoodRadarWeek;

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
          last_good_radar: lastGoodRadar,
          last_good_radar_week: lastGoodRadarWeek,
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
