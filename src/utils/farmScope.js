/** Resolve trees, rows, zones, and money records for the active farm. */

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

export async function loadFarmTreeIds(supabase, farmId) {
  if (!farmId) return [];
  const ids = new Set();

  const sectionIds = await loadFarmSectionIds(supabase, farmId);
  if (sectionIds.length) {
    const { data: lots } = await supabase.from('lots').select('id').in('section_id', sectionIds);
    const lotIds = (lots || []).map((l) => l.id);
    if (lotIds.length) {
      const { data: positions } = await supabase
        .from('tree_positions')
        .select('id')
        .in('lot_id', lotIds);
      const posIds = (positions || []).map((p) => p.id);
      if (posIds.length) {
        const { data: trees } = await supabase.from('trees').select('id').in('position_id', posIds);
        (trees || []).forEach((t) => ids.add(Number(t.id)));
      }
    }
  }

  const zoneIds = await loadFarmZoneIds(supabase, farmId);
  if (zoneIds.length) {
    const { data: links } = await supabase
      .from('tree_irrigation_zones')
      .select('tree_id')
      .in('zone_id', zoneIds);
    (links || []).forEach((row) => {
      if (row.tree_id) ids.add(Number(row.tree_id));
    });
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
  const allowed = new Set((treeIds || []).map(Number));
  return (rows || []).filter((row) => allowed.has(Number(row[key])));
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
  const notes = String(expense?.notes || '');
  const farmMatch = notes.match(/^farm:(\d+)/);
  if (farmMatch) return Number(farmMatch[1]) === Number(farmId);
  const zoneMatch = notes.match(/^zone:(\d+)/);
  if (zoneMatch) return zoneIdSet.has(Number(zoneMatch[1]));
  if (notes.startsWith('tree:')) return treeIdSet.has(Number(notes.slice(5)));
  return false;
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
  const treeIdSet = new Set((treeIds || []).map(Number));
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
