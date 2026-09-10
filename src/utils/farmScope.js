/** Resolve trees, rows, zones, and money records for the active farm. */

function addId(set, value) {
  if (value == null || value === '') return;
  set.add(value);
}

export async function loadFarmSectionIds(supabase, farmId) {
  if (!farmId) return [];
  const { data: phases } = await supabase.from('phases').select('id').eq('farm_id', farmId);
  const phaseIds = (phases || []).map((p) => p.id);
  if (!phaseIds.length) return [];
  const { data: sections } = await supabase.from('sections').select('id').in('phase_id', phaseIds);
  return (sections || []).map((s) => s.id);
}

export async function loadFarmZoneIds(supabase, farmId) {
  if (!farmId) return [];
  const { data } = await supabase.from('irrigation_zones').select('id').eq('farm_id', farmId);
  return (data || []).map((z) => z.id);
}

export async function loadFarmLotIds(supabase, farmId) {
  const sectionIds = await loadFarmSectionIds(supabase, farmId);
  const lotIds = new Set();
  if (!sectionIds.length) return [];

  const { data: sectionLots } = await supabase.from('lots').select('id').in('section_id', sectionIds);
  (sectionLots || []).forEach((lot) => addId(lotIds, lot.id));

  const { data: rows } = await supabase.from('rows').select('id').in('section_id', sectionIds);
  const rowIds = (rows || []).map((row) => row.id);
  if (rowIds.length) {
    const { data: lotRowLinks } = await supabase.from('lot_rows').select('lot_id').in('row_id', rowIds);
    (lotRowLinks || []).forEach((link) => addId(lotIds, link.lot_id));

    const { data: legacyLots, error: legacyError } = await supabase
      .from('lots')
      .select('id')
      .in('row_id', rowIds);
    if (!legacyError) {
      (legacyLots || []).forEach((lot) => addId(lotIds, lot.id));
    }
  }

  return [...lotIds];
}

export async function loadFarmTreeIds(supabase, farmId) {
  if (!farmId) return [];
  const ids = new Set();

  const lotIds = await loadFarmLotIds(supabase, farmId);
  if (lotIds.length) {
    const { data: positions } = await supabase
      .from('tree_positions')
      .select('id')
      .in('lot_id', lotIds);
    const posIds = (positions || []).map((p) => p.id);
    if (posIds.length) {
      const { data: trees } = await supabase.from('trees').select('id').in('position_id', posIds);
      (trees || []).forEach((t) => addId(ids, t.id));
    }
  }

  const zoneIds = await loadFarmZoneIds(supabase, farmId);
  if (zoneIds.length) {
    const { data: links } = await supabase
      .from('tree_irrigation_zones')
      .select('tree_id')
      .in('zone_id', zoneIds);
    (links || []).forEach((row) => addId(ids, row.tree_id));
  }

  return [...ids];
}

export async function loadFarmTrees(supabase, farmId, {
  select = 'id, tree_positions(position_code)',
  activeOnly = true,
} = {}) {
  const ids = await loadFarmTreeIds(supabase, farmId);
  if (!ids.length) return [];
  let query = supabase.from('trees').select(select).in('id', ids);
  if (activeOnly) query = query.eq('status', 'Active');
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function loadFarmRows(supabase, farmId, select) {
  const sectionIds = await loadFarmSectionIds(supabase, farmId);
  if (!sectionIds.length) return [];
  const { data, error } = await supabase
    .from('rows')
    .select(select)
    .in('section_id', sectionIds)
    .order('name');
  if (error) throw error;
  return data || [];
}

export function filterByTreeIds(rows, treeIds, key = 'tree_id') {
  const allowed = new Set((treeIds || []).map((id) => String(id)));
  return (rows || []).filter((row) => allowed.has(String(row[key])));
}

export function expenseScopeNotes({ scopeType, scopeId, farmId }) {
  if (scopeType === 'zone' && scopeId) return `zone:${scopeId}`;
  if (scopeType === 'tree' && scopeId) return `tree:${scopeId}`;
  if (farmId) return `farm:${farmId}`;
  return null;
}

export function parseExpenseScope(notes) {
  const text = String(notes || '');
  const farm = text.match(/^farm:(\d+)/);
  if (farm) return { type: 'farm', id: Number(farm[1]) };
  const zone = text.match(/^zone:(\d+)/);
  if (zone) return { type: 'zone', id: Number(zone[1]) };
  const tree = text.match(/^tree:(\d+)/);
  if (tree) return { type: 'tree', id: Number(tree[1]) };
  return { type: null, id: null };
}

export function expenseMatchesFarm(expense, { farmId, zoneIdSet, treeIdSet, expenseIdSet }) {
  if (expenseIdSet?.has(Number(expense.id))) return true;
  const scope = parseExpenseScope(expense?.notes);
  if (scope.type === 'farm') return Number(scope.id) === Number(farmId);
  if (scope.type === 'zone') return zoneIdSet.has(Number(scope.id));
  if (scope.type === 'tree') return treeIdSet.has(String(scope.id)) || treeIdSet.has(Number(scope.id));
  // Legacy rows with free-text or empty notes are not farm-tagged.
  return true;
}

export async function loadFarmExpenses(supabase, farmId, {
  zoneIds = [],
  treeIds = [],
  sinceDate = null,
  select = '*',
  limit = 200,
} = {}) {
  let query = supabase.from('expenses').select(select).order('expense_date', { ascending: false }).limit(limit);
  if (sinceDate) query = query.gte('expense_date', sinceDate);
  const { data, error } = await query;
  if (error) throw error;

  const zoneIdSet = new Set((zoneIds || []).map(Number));
  const treeIdSet = new Set((treeIds || []).flatMap((id) => [id, Number(id), String(id)]));
  const expenseIdSet = new Set();
  if (treeIds.length) {
    const { data: allocs } = await supabase
      .from('expense_allocations')
      .select('expense_id')
      .in('tree_id', treeIds);
    (allocs || []).forEach((row) => expenseIdSet.add(Number(row.expense_id)));
  }

  return (data || []).filter((row) => expenseMatchesFarm(row, {
    farmId,
    zoneIdSet,
    treeIdSet,
    expenseIdSet,
  }));
}

export async function loadFarmLabourEvents(supabase, { zoneIds = [], treeIds = [], limit = 50 } = {}) {
  if (!zoneIds.length && !treeIds.length) return [];
  const parts = [];
  if (zoneIds.length) parts.push(`zone_id.in.(${zoneIds.join(',')})`);
  if (treeIds.length) parts.push(`tree_id.in.(${treeIds.join(',')})`);
  const { data, error } = await supabase
    .from('labour_events')
    .select('*')
    .or(parts.join(','))
    .order('event_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
