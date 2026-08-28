import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hashKey(key: string) {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(value: unknown) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', 'yes', 'start'].includes(normalized)) return true;
    if (['false', 'off', 'no', 'stop'].includes(normalized)) return false;
  }
  return null;
}

function normalizeZoneCode(raw: unknown) {
  if (raw == null) return null;
  const text = String(raw).trim().toUpperCase();
  return text || null;
}

function extractApiKey(req: Request) {
  const headerKey = req.headers.get('x-api-key')?.trim();
  if (headerKey) return headerKey;

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ta_')) {
    return authHeader.slice(7).trim();
  }

  return '';
}

function parseTimestamp(raw: unknown) {
  if (raw == null || raw === '') return null;
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return jsonResponse({
      error: 'Missing ingest API key. Send header: x-api-key: ta_...',
    }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const keyHash = await hashKey(apiKey);

  const { data: keyRow, error: keyError } = await supabase
    .from('farm_ingest_keys')
    .select('id, farm_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (keyError) {
    return jsonResponse({ error: keyError.message }, 500);
  }
  if (!keyRow) {
    return jsonResponse({ error: 'Invalid or revoked API key' }, 401);
  }

  if (req.method === 'GET') {
    const { data: commands, error: commandError } = await supabase
      .from('irrigation_zone_status')
      .select('zone_id, pending_command, pending_command_at, is_irrigating')
      .eq('farm_id', keyRow.farm_id)
      .not('pending_command', 'is', null);

    if (commandError) {
      return jsonResponse({ error: commandError.message }, 500);
    }

    const { data: zones } = await supabase
      .from('irrigation_zones')
      .select('id, zone_code')
      .eq('farm_id', keyRow.farm_id);

    const zoneCodeById = new Map((zones || []).map((zone) => [zone.id, zone.zone_code]));
    const pending = (commands || []).map((row) => ({
      zone_code: zoneCodeById.get(row.zone_id) || null,
      command: row.pending_command,
      command_at: row.pending_command_at,
      is_irrigating: row.is_irrigating,
    }));

    return jsonResponse({ ok: true, pending_commands: pending });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const zoneCode = normalizeZoneCode(body.zone_code ?? body.zone);
  if (!zoneCode) {
    return jsonResponse({ error: 'Missing zone_code (must match irrigation_zones.zone_code)' }, 400);
  }

  const { data: zoneRow, error: zoneError } = await supabase
    .from('irrigation_zones')
    .select('id, farm_id, zone_code')
    .eq('farm_id', keyRow.farm_id)
    .eq('zone_code', zoneCode)
    .maybeSingle();

  if (zoneError) {
    return jsonResponse({ error: zoneError.message }, 500);
  }
  if (!zoneRow) {
    return jsonResponse({
      error: `No irrigation zone found with code ${zoneCode} on this farm`,
      zone_code: zoneCode,
    }, 404);
  }

  const startIndicator = parseBoolean(body.start_indicator) ?? false;
  const stopIndicator = parseBoolean(body.stop_indicator) ?? false;
  const explicitIrrigating = parseBoolean(body.is_irrigating);
  const isIrrigating = explicitIrrigating ?? (startIndicator && !stopIndicator);

  const startedAtRaw = body.started_at ?? body.start_time;
  const startedAt = isIrrigating
    ? (parseTimestamp(startedAtRaw) ?? parseTimestamp(body.reported_at) ?? new Date().toISOString())
    : null;

  const reportedAt = parseTimestamp(body.reported_at) ?? new Date().toISOString();
  const now = new Date().toISOString();
  const ackCommand = parseBoolean(body.ack_command ?? body.command_ack) === true;

  const payload: Record<string, unknown> = {
    zone_id: zoneRow.id,
    farm_id: zoneRow.farm_id,
    is_irrigating: isIrrigating,
    started_at: startedAt,
    voltage_v: parseNumber(body.voltage_v ?? body.voltage),
    current_amp: parseNumber(body.current_amp ?? body.amp ?? body.amperage),
    start_indicator: startIndicator,
    stop_indicator: stopIndicator,
    current_discharge_lpm: parseNumber(body.current_discharge_lpm ?? body.current_discharge),
    total_discharge_liters: parseNumber(body.total_discharge_liters ?? body.total_discharge),
    device_code: body.device_code ? String(body.device_code).trim() : null,
    reported_at: reportedAt,
    updated_at: now,
  };

  if (ackCommand) {
    payload.pending_command = null;
    payload.pending_command_at = null;
  }

  const { error: upsertError } = await supabase
    .from('irrigation_zone_status')
    .upsert(payload, { onConflict: 'zone_id' });

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500);
  }

  await supabase
    .from('farm_ingest_keys')
    .update({ last_used_at: now })
    .eq('id', keyRow.id);

  const { data: latest, error: latestError } = await supabase
    .from('irrigation_zone_status')
    .select('pending_command, pending_command_at')
    .eq('zone_id', zoneRow.id)
    .maybeSingle();

  if (latestError) {
    return jsonResponse({ error: latestError.message }, 500);
  }

  return jsonResponse({
    ok: true,
    zone_id: zoneRow.id,
    zone_code: zoneRow.zone_code,
    is_irrigating: isIrrigating,
    pending_command: latest?.pending_command ?? null,
    pending_command_at: latest?.pending_command_at ?? null,
  });
});
