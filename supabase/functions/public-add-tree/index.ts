import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const LOT_SELECT = `
  id,
  name,
  section_id,
  sections ( name ),
  lot_rows ( row_id, rows ( id, name, sections ( name ) ) )
`;

const POSITION_CODE_REGEX = /^([AB])-(R\d{2})-(L\d{2})-(T\d{2})$/i;

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

function extractApiKey(req: Request) {
  const headerKey = req.headers.get('x-api-key')?.trim();
  if (headerKey) return headerKey;
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ta_')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

async function resolveFarmFromKey(supabase: ReturnType<typeof createClient>, apiKey: string) {
  const keyHash = await hashKey(apiKey);
  const { data: keyRow, error } = await supabase
    .from('farm_ingest_keys')
    .select('id, farm_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!keyRow) return { error: 'Invalid or revoked access key' };
  return { keyRow };
}

async function fetchLotsForFarm(supabase: ReturnType<typeof createClient>, farmId: number) {
  const lotMap = new Map<number, Record<string, unknown>>();

  const { data: phases, error: phasesError } = await supabase
    .from('phases')
    .select('id')
    .eq('farm_id', farmId);
  if (phasesError) throw new Error(phasesError.message);

  const phaseIds = (phases || []).map((p) => p.id);
  if (phaseIds.length === 0) return [];

  const { data: sections, error: sectionsError } = await supabase
    .from('sections')
    .select('id')
    .in('phase_id', phaseIds);
  if (sectionsError) throw new Error(sectionsError.message);

  const sectionIds = (sections || []).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data: sectionLots, error: lotsError } = await supabase
    .from('lots')
    .select(LOT_SELECT)
    .in('section_id', sectionIds);
  if (lotsError) throw new Error(lotsError.message);
  (sectionLots || []).forEach((lot) => lotMap.set(lot.id, lot));

  const { data: rows, error: rowsError } = await supabase
    .from('rows')
    .select('id')
    .in('section_id', sectionIds);
  if (rowsError) throw new Error(rowsError.message);

  const rowIds = (rows || []).map((r) => r.id);
  if (rowIds.length > 0) {
    const { data: rowLots, error: legacyError } = await supabase
      .from('lots')
      .select('id, name, row_id, rows ( name, sections ( name ) )')
      .in('row_id', rowIds);
    if (legacyError) throw new Error(legacyError.message);
    (rowLots || []).forEach((lot) => lotMap.set(lot.id, lot));
  }

  return Array.from(lotMap.values());
}

async function loadBootstrap(supabase: ReturnType<typeof createClient>, farmId: number) {
  const { data: farm } = await supabase.from('farms').select('id, name').eq('id', farmId).maybeSingle();

  let lots: unknown[] = [];
  try {
    lots = await fetchLotsForFarm(supabase, farmId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load lots' };
  }

  const { data: varieties, error: varietiesError } = await supabase
    .from('tree_varieties')
    .select('id, name')
    .eq('farm_id', farmId)
    .order('name');
  if (varietiesError) return { error: varietiesError.message };

  return {
    farm_name: farm?.name || '',
    lots,
    varieties: varieties || [],
  };
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return jsonResponse({ error: 'Missing access key. Use header x-api-key: ta_...' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const resolved = await resolveFarmFromKey(supabase, apiKey);
  if ('error' in resolved && resolved.error) {
    return jsonResponse({ error: resolved.error }, 401);
  }
  const { keyRow } = resolved as { keyRow: { id: number; farm_id: number } };

  if (req.method === 'GET') {
    const bootstrap = await loadBootstrap(supabase, keyRow.farm_id);
    if ('error' in bootstrap && bootstrap.error) {
      return jsonResponse({ error: bootstrap.error }, 500);
    }
    return jsonResponse({ ok: true, ...bootstrap });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const positionCode = String(body.position_code || '').trim().toUpperCase();
  const lotId = parseNumber(body.lot_id);
  const variety = String(body.variety || '').trim();
  const plantingDate = String(body.planting_date || '').trim();
  const status = String(body.status || 'Active').trim() || 'Active';
  const latitude = parseNumber(body.latitude);
  const longitude = parseNumber(body.longitude);

  if (!positionCode || !POSITION_CODE_REGEX.test(positionCode)) {
    return jsonResponse({ error: 'Invalid position_code (expected e.g. A-R01-L01-T01)' }, 400);
  }
  if (!lotId) {
    return jsonResponse({ error: 'lot_id is required' }, 400);
  }
  if (!variety || !plantingDate) {
    return jsonResponse({ error: 'variety and planting_date are required' }, 400);
  }
  if (latitude == null || longitude == null) {
    return jsonResponse({ error: 'latitude and longitude are required' }, 400);
  }

  let farmLots: Record<string, unknown>[] = [];
  try {
    farmLots = await fetchLotsForFarm(supabase, keyRow.farm_id);
  } catch (err) {
    return jsonResponse({
      error: err instanceof Error ? err.message : 'Failed to validate lot',
    }, 500);
  }

  const allowedLotIds = new Set(farmLots.map((lot) => Number(lot.id)));
  if (!allowedLotIds.has(lotId)) {
    return jsonResponse({ error: 'Selected lot does not belong to this farm' }, 403);
  }

  const { data: existingPosition } = await supabase
    .from('tree_positions')
    .select('id, trees(id, status)')
    .eq('position_code', positionCode)
    .maybeSingle();

  if (existingPosition?.trees?.some((t: { status: string }) => t.status === 'Active')) {
    return jsonResponse({ error: `Position ${positionCode} already has an active tree` }, 409);
  }

  let positionId = existingPosition?.id as number | undefined;

  if (!positionId) {
    const { data: newPosition, error: posError } = await supabase
      .from('tree_positions')
      .insert([{
        position_code: positionCode,
        lot_id: lotId,
        latitude,
        longitude,
      }])
      .select('id')
      .single();
    if (posError) return jsonResponse({ error: posError.message }, 500);
    positionId = newPosition.id;
  } else {
    const { error: gpsError } = await supabase
      .from('tree_positions')
      .update({ latitude, longitude })
      .eq('id', positionId);
    if (gpsError) return jsonResponse({ error: gpsError.message }, 500);
  }

  const { data: tree, error: treeError } = await supabase
    .from('trees')
    .insert([{
      position_id: positionId,
      variety,
      planting_date: plantingDate,
      status,
    }])
    .select('id')
    .single();

  if (treeError) return jsonResponse({ error: treeError.message }, 500);

  await supabase
    .from('farm_ingest_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id);

  return jsonResponse({
    ok: true,
    tree_id: tree?.id,
    position_code: positionCode,
    position_id: positionId,
  });
});
