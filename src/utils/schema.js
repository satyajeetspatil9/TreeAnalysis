// Schema helpers aligned with tree_positions + trees (instances)

export const TREE_STATUS = ['Active', 'Removed', 'Replaced', 'Dead'];

export const POSITION_WITH_LOT = `
  id,
  position_code,
  lot_id,
  latitude,
  longitude,
  elevation_m,
  lots (
    name,
    section_id,
    sections ( id, name ),
    lot_rows ( row_id, rows ( id, name, section_id, sections ( id, name ) ) )
  )
`;

export const TREE_DETAIL_SELECT = `
  *,
  tree_positions ( ${POSITION_WITH_LOT.trim()} ),
  tree_irrigation_zones (
    zone_id,
    start_date,
    end_date,
    irrigation_zones ( id, zone_code )
  )
`;

export const TREE_LIST_SELECT = `
  *,
  tree_positions (
    id,
    position_code,
    lot_id,
    latitude,
    longitude,
    lots (
      name,
      section_id,
      sections ( id, name ),
      lot_rows ( row_id, rows ( id, name, section_id, sections ( id, name ) ) )
    )
  ),
  tree_irrigation_zones (
    zone_id,
    end_date,
    irrigation_zones ( zone_code )
  )
`;

export const POSITION_MAP_SELECT = `
  id,
  position_code,
  latitude,
  longitude,
  trees ( id, status, variety, planting_date )
`;

export function getPositionCode(treeOrRecord) {
  return treeOrRecord?.tree_positions?.position_code
    || treeOrRecord?.position_code
    || '—';
}

export function getActiveTreeInstance(instances) {
  if (!instances?.length) return null;
  return instances.find((t) => t.status === 'Active')
    || [...instances].sort((a, b) => new Date(b.planting_date || 0) - new Date(a.planting_date || 0))[0];
}

export function getActiveIrrigationLink(tree) {
  const links = tree?.tree_irrigation_zones || [];
  return links.find((link) => !link.end_date) || links[0] || null;
}

export function getIrrigationZoneCode(tree) {
  return getActiveIrrigationLink(tree)?.irrigation_zones?.zone_code || '—';
}

export function getIrrigationZoneId(tree) {
  return getActiveIrrigationLink(tree)?.irrigation_zones?.id || null;
}

export function getTreeGps(tree) {
  const position = tree?.tree_positions;
  if (!position) return null;

  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

export async function fetchTreeByPositionCode(supabase, positionCode) {
  const { data: position, error: posError } = await supabase
    .from('tree_positions')
    .select(`
      ${POSITION_WITH_LOT},
      trees ( id, status, planting_date )
    `)
    .eq('position_code', positionCode)
    .maybeSingle();

  if (posError) throw posError;
  if (!position || !position.trees?.length) return null;

  const activeTree = getActiveTreeInstance(position.trees);
  const target = activeTree || [...position.trees].sort(
    (a, b) => new Date(b.planting_date || 0) - new Date(a.planting_date || 0)
  )[0];

  const { data: treeDetail, error: treeError } = await supabase
    .from('trees')
    .select(TREE_DETAIL_SELECT)
    .eq('id', target.id)
    .single();

  if (treeError) throw treeError;

  const { data: allInstances } = await supabase
    .from('trees')
    .select('id, variety, planting_date, removed_date, status, notes, created_at')
    .eq('position_id', position.id)
    .order('planting_date', { ascending: true });

  return { ...treeDetail, all_instances: allInstances || [] };
}

export async function fetchPositionHistory(supabase, positionId) {
  const { data } = await supabase
    .from('trees')
    .select('id, variety, planting_date, removed_date, status, notes, created_at')
    .eq('position_id', positionId)
    .order('planting_date', { ascending: true });
  return data || [];
}
