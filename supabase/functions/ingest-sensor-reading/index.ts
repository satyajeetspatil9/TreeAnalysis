import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SENSOR_METHOD = '7-in-1 sensor';
const SENSOR_SOURCE = 'SENSOR';
const POSITION_CODE_REGEX = /^([AB])-(R\d{2})-(L\d{2})-(T\d{2})$/i;
const SENSOR_FIELD_KEYS = [
  'moisture_percent',
  'ph',
  'ec',
  'temperature_c',
  'nitrogen',
  'phosphorus',
  'potassium',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function normalizePositionCode(raw: string | undefined) {
  if (!raw) return null;
  const text = String(raw).trim();
  const direct = text.toUpperCase().match(POSITION_CODE_REGEX);
  if (direct) return direct[0];

  const embedded = text.toUpperCase().match(/([AB]-R\d{2}-L\d{2}-T\d{2})/);
  return embedded ? embedded[1] : null;
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
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
      error: 'Missing ingest API key. Send header: x-api-key: ta_... (do not use Authorization for the ingest key).',
    }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const positionCode = normalizePositionCode(String(body.position_code || ''));
  if (!positionCode) {
    return jsonResponse({ error: 'Invalid or missing position_code (expected e.g. A-R01-L01-T01)' }, 400);
  }

  const readings: Record<string, number | null> = {};
  let hasReading = false;
  for (const key of SENSOR_FIELD_KEYS) {
    const value = parseNumber(body[key]);
    readings[key] = value;
    if (value != null) hasReading = true;
  }

  if (!hasReading) {
    return jsonResponse({ error: 'Provide at least one sensor reading field' }, 400);
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

  const { data: treeId, error: treeError } = await supabase.rpc('resolve_active_tree_for_position', {
    p_farm_id: keyRow.farm_id,
    p_position_code: positionCode,
  });

  if (treeError) {
    return jsonResponse({ error: treeError.message }, 500);
  }
  if (!treeId) {
    return jsonResponse({
      error: `No active tree found for position ${positionCode} on this farm`,
      position_code: positionCode,
    }, 404);
  }

  const observedAt = body.observed_at
    ? new Date(String(body.observed_at)).toISOString()
    : new Date().toISOString();

  const payload = {
    tree_id: treeId,
    source: SENSOR_SOURCE,
    method: SENSOR_METHOD,
    observed_at: observedAt,
    ...readings,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('soil_observations')
    .insert([payload])
    .select('id')
    .single();

  if (insertError) {
    return jsonResponse({ error: insertError.message }, 500);
  }

  await supabase
    .from('farm_ingest_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id);

  return jsonResponse({
    ok: true,
    observation_id: inserted?.id,
    tree_id: treeId,
    position_code: positionCode,
  });
});
