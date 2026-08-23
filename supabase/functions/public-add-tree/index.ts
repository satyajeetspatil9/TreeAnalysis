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

async function attachLegacyRowLinks(
  supabase: ReturnType<typeof createClient>,
  lot: Record<string, unknown>,
) {
  const rowId = lot.row_id as number | null | undefined;
  if (!rowId || (Array.isArray(lot.lot_rows) && lot.lot_rows.length > 0)) {
    return lot;
  }

  const { data: rowData } = await supabase
    .from('rows')
    .select('id, name, sections ( name )')
    .eq('id', rowId)
    .maybeSingle();

  if (!rowData) return lot;

  return {
    ...lot,
    lot_rows: [{ row_id: rowId, rows: rowData }],
  };
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
  for (const lot of sectionLots || []) {
    lotMap.set(lot.id, await attachLegacyRowLinks(supabase, lot));
  }

  const { data: rows, error: rowsError } = await supabase
    .from('rows')
    .select('id')
    .in('section_id', sectionIds);
  if (rowsError) throw new Error(rowsError.message);

  const rowIds = (rows || []).map((r) => r.id);
  if (rowIds.length > 0) {
    const { data: lotRowLinks, error: linkError } = await supabase
      .from('lot_rows')
      .select('lot_id')
      .in('row_id', rowIds);
    if (linkError) throw new Error(linkError.message);

    const linkedLotIds = [...new Set((lotRowLinks || []).map((link) => link.lot_id))]
      .filter((id) => !lotMap.has(id));

    if (linkedLotIds.length > 0) {
      const { data: linkedLots, error: linkedLotsError } = await supabase
        .from('lots')
        .select(LOT_SELECT)
        .in('id', linkedLotIds);
      if (linkedLotsError) throw new Error(linkedLotsError.message);
      for (const lot of linkedLots || []) {
        lotMap.set(lot.id, await attachLegacyRowLinks(supabase, lot));
      }
    }

    const { data: legacyLots, error: legacyError } = await supabase
      .from('lots')
      .select('id, name, row_id, section_id, sections ( name )')
      .in('row_id', rowIds);
    if (legacyError) throw new Error(legacyError.message);

    for (const lot of legacyLots || []) {
      if (lotMap.has(lot.id)) continue;
      lotMap.set(lot.id, await attachLegacyRowLinks(supabase, lot));
    }
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

async function fetchExistingTreeAtPosition(
  supabase: ReturnType<typeof createClient>,
  farmId: number,
  positionCode: string,
) {
  const { data: position, error } = await supabase
    .from('tree_positions')
    .select('id, lot_id, latitude, longitude, trees(id, status, variety, planting_date)')
    .eq('position_code', positionCode)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!position) return { existing: null };

  let farmLots: Record<string, unknown>[] = [];
  try {
    farmLots = await fetchLotsForFarm(supabase, farmId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to validate position' };
  }

  const allowedLotIds = new Set(farmLots.map((lot) => Number(lot.id)));
  if (!allowedLotIds.has(Number(position.lot_id))) {
    return { existing: null };
  }

  const trees = (position.trees || []) as Array<{
    id: number;
    status: string;
    variety: string;
    planting_date: string;
  }>;
  const activeTree = trees.find((t) => t.status === 'Active');
  if (!activeTree) return { existing: null };

  return {
    existing: {
      tree_id: activeTree.id,
      position_id: position.id,
      variety: activeTree.variety,
      planting_date: activeTree.planting_date,
      status: activeTree.status,
      latitude: position.latitude,
      longitude: position.longitude,
    },
  };
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const TREE_PHOTOS_BUCKET = 'tree-photos';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function plantingDateToTakenAt(plantingDate: string) {
  return new Date(plantingDate).toISOString();
}

function parsePhotoPayload(body: Record<string, unknown>) {
  const raw = body.photo_base64;
  if (!raw || typeof raw !== 'string') return { photo: null as null };

  let base64 = raw.trim();
  let contentType = String(body.photo_content_type || 'image/jpeg');

  const dataUrlMatch = base64.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    contentType = dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  }

  if (!contentType.startsWith('image/')) {
    return { error: 'photo_content_type must be an image type' };
  }

  try {
    const binary = atob(base64);
    if (binary.length > MAX_PHOTO_BYTES) {
      return { error: 'Photo exceeds 10 MB limit' };
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return { photo: { bytes, contentType } };
  } catch {
    return { error: 'Invalid photo_base64' };
  }
}

async function saveTreePhoto(
  supabase: ReturnType<typeof createClient>,
  treeId: number,
  photo: { bytes: Uint8Array; contentType: string },
  takenAt: string,
) {
  const ext = photo.contentType.includes('png') ? 'png'
    : photo.contentType.includes('webp') ? 'webp'
    : photo.contentType.includes('gif') ? 'gif'
    : 'jpg';
  const path = `${treeId}/${Date.now()}-add-tree.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(TREE_PHOTOS_BUCKET)
    .upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { data: urlData } = supabase.storage.from(TREE_PHOTOS_BUCKET).getPublicUrl(path);
  const photoUrl = urlData?.publicUrl;
  if (!photoUrl) return { error: 'Upload succeeded but public URL was not returned' };

  const { error: insertError } = await supabase.from('photos').insert([{
    tree_id: treeId,
    photo_url: photoUrl,
    photo_type: 'TREE',
    description: null,
    taken_at: takenAt,
  }]);
  if (insertError) return { error: insertError.message };

  return { photo_url: photoUrl };
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
    const url = new URL(req.url);
    const positionCode = url.searchParams.get('position_code')?.trim().toUpperCase() || '';

    if (positionCode) {
      if (!POSITION_CODE_REGEX.test(positionCode)) {
        return jsonResponse({ error: 'Invalid position_code (expected e.g. A-R01-L01-T01)' }, 400);
      }
      const lookup = await fetchExistingTreeAtPosition(supabase, keyRow.farm_id, positionCode);
      if ('error' in lookup && lookup.error) {
        return jsonResponse({ error: lookup.error }, 500);
      }
      return jsonResponse({ ok: true, existing: lookup.existing ?? null });
    }

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

  const photoPayload = parsePhotoPayload(body);
  if ('error' in photoPayload && photoPayload.error) {
    return jsonResponse({ error: photoPayload.error }, 400);
  }
  const optionalPhoto = photoPayload.photo;
  const takenAt = plantingDateToTakenAt(plantingDate);

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
    .select('id, lot_id, trees(id, status, variety, planting_date)')
    .eq('position_code', positionCode)
    .maybeSingle();

  const activeTree = (existingPosition?.trees as Array<{ id: number; status: string }> | undefined)
    ?.find((t) => t.status === 'Active');

  if (activeTree && existingPosition) {
    if (!allowedLotIds.has(Number(existingPosition.lot_id))) {
      return jsonResponse({ error: 'Position does not belong to this farm' }, 403);
    }

    const { error: posError } = await supabase
      .from('tree_positions')
      .update({ latitude, longitude, lot_id: lotId })
      .eq('id', existingPosition.id);
    if (posError) return jsonResponse({ error: posError.message }, 500);

    const { error: treeError } = await supabase
      .from('trees')
      .update({ variety, planting_date: plantingDate, status })
      .eq('id', activeTree.id);
    if (treeError) return jsonResponse({ error: treeError.message }, 500);

    await supabase
      .from('farm_ingest_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id);

    let photoSaved = false;
    if (optionalPhoto) {
      const photoResult = await saveTreePhoto(supabase, activeTree.id, optionalPhoto, takenAt);
      if ('error' in photoResult && photoResult.error) {
        return jsonResponse({ error: photoResult.error }, 500);
      }
      photoSaved = true;
    }

    return jsonResponse({
      ok: true,
      updated: true,
      tree_id: activeTree.id,
      position_code: positionCode,
      position_id: existingPosition.id,
      photo_saved: photoSaved,
    });
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

  let photoSaved = false;
  if (optionalPhoto && tree?.id) {
    const photoResult = await saveTreePhoto(supabase, tree.id, optionalPhoto, takenAt);
    if ('error' in photoResult && photoResult.error) {
      return jsonResponse({ error: photoResult.error }, 500);
    }
    photoSaved = true;
  }

  return jsonResponse({
    ok: true,
    tree_id: tree?.id,
    position_code: positionCode,
    position_id: positionId,
    photo_saved: photoSaved,
  });
});
