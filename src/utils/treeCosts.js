import { getIrrigationZoneId } from './schema';
import {
  mergeFertilizerEvents,
  buildTreeCostByEvent,
  computeFertilizerCostTotals,
  isFertilizerAllocation,
  collectProductIdsFromRawEvents,
  loadFertilizerCostSources,
  parseFertilizerEventNote,
} from './fertilizer';

function allocationCategory(row) {
  if (row.expenses?.category) return row.expenses.category;
  const notes = row.expenses?.notes;
  if (parseFertilizerEventNote(notes)) return 'Fertilizer';
  if (notes?.startsWith('spray_event:')) return 'Plant protection';
  return 'Other';
}

function addToCategory(map, category, amount) {
  const value = Number(amount || 0);
  if (!value) return;
  map[category] = (map[category] || 0) + value;
}

export async function loadTreeCostBreakdown(supabase, tree) {
  const zoneId = getIrrigationZoneId(tree);
  const byCategory = {};
  let loadError = null;

  const allocationQuery = supabase
    .from('expense_allocations')
    .select('allocation_amount, expenses(category, notes)')
    .eq('tree_id', tree.id);

  const requests = [
    allocationQuery,
    zoneId
      ? supabase
        .from('tree_irrigation_zones')
        .select('tree_id, trees!inner(status)')
        .eq('zone_id', zoneId)
        .is('end_date', null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('labour_events').select('amount').eq('tree_id', tree.id),
    zoneId
      ? supabase.from('labour_events').select('amount').eq('zone_id', zoneId)
      : Promise.resolve({ data: [], error: null }),
  ];

  let soilEvents = [];
  let fertigationEvents = [];

  if (zoneId) {
    requests.push(
      supabase
        .from('soil_application_events')
        .select(`
          *,
          soil_application_products(id, product_id, quantity, unit, unit_cost, products(name))
        `)
        .or(`and(zone_id.eq.${zoneId},tree_id.is.null),tree_id.eq.${tree.id}`)
        .order('event_date', { ascending: false })
        .limit(50),
      supabase
        .from('fertigation_events')
        .select(`
          *,
          fertigation_products(id, product_id, quantity, unit, products(name))
        `)
        .eq('zone_id', zoneId)
        .order('event_date', { ascending: false })
        .limit(50)
    );
  }

  const results = await Promise.all(requests);
  const [
    { data: allocations, error: allocError },
    { data: zoneTrees },
    { data: directLabour },
    { data: zoneLabour },
  ] = results;

  if (zoneId) {
    soilEvents = results[4]?.data || [];
    fertigationEvents = results[5]?.data || [];
    if (results[4]?.error) loadError = results[4].error.message;
    if (results[5]?.error) loadError = results[5].error.message;
  }

  if (allocError) loadError = allocError.message;

  (allocations || []).forEach((row) => {
    addToCategory(byCategory, allocationCategory(row), row.allocation_amount);
  });

  const activeCount = (zoneTrees || []).filter((row) => row.trees?.status === 'Active').length;
  const directLabourTotal = (directLabour || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const zoneLabourTotal = (zoneLabour || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const labourTotal = directLabourTotal
    + (activeCount > 0 ? zoneLabourTotal / activeCount : 0);
  addToCategory(byCategory, 'Labour', labourTotal);

  const fertilizerAllocated = byCategory.Fertilizer || 0;
  if (fertilizerAllocated <= 0 && zoneId && (soilEvents.length || fertigationEvents.length)) {
    const mergedEvents = mergeFertilizerEvents(soilEvents, fertigationEvents);
    const fertilizerAllocations = (allocations || []).filter(isFertilizerAllocation);
    const productIds = collectProductIdsFromRawEvents(soilEvents, fertigationEvents);
    const costSources = await loadFertilizerCostSources(supabase, mergedEvents, productIds);
    const { treeCost } = computeFertilizerCostTotals(
      mergedEvents,
      activeCount,
      buildTreeCostByEvent(fertilizerAllocations),
      costSources.zoneCostByEvent,
      costSources.unitCostByProduct
    );
    addToCategory(byCategory, 'Fertilizer', treeCost);
  }

  const breakdown = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const total = breakdown.reduce((sum, row) => sum + row.amount, 0);

  return { breakdown, total, loadError };
}

function addToCategoryMap(map, category, amount) {
  const value = Number(amount || 0);
  if (!value) return;
  map[category] = (map[category] || 0) + value;
}

function emptyTreeCostRow(treeId, code) {
  return {
    id: treeId,
    code: code || treeId,
    capex: 0,
    opex: 0,
    total: 0,
  };
}

function addTreeCost(treeMap, treeId, code, amount, expenseType) {
  const value = Number(amount || 0);
  if (!treeId || !value) return;
  if (!treeMap[treeId]) treeMap[treeId] = emptyTreeCostRow(treeId, code);
  else if (code) treeMap[treeId].code = code;

  if (expenseType === 'CAPEX') treeMap[treeId].capex += value;
  else treeMap[treeId].opex += value;
  treeMap[treeId].total += value;
}

export async function loadFarmCostAnalysis(supabase, farmId) {
  if (!farmId) {
    return {
      byCategory: [],
      byTree: [],
      totals: { capex: 0, opex: 0, total: 0 },
      topTrees: [],
    };
  }

  const { data: zones } = await supabase
    .from('irrigation_zones')
    .select('id')
    .eq('farm_id', farmId);
  const zoneIds = (zones || []).map((z) => z.id);

  const [
    { data: expenses },
    { data: allocs },
    { data: directLabour },
    { data: zoneLabour },
    { data: zoneTreeLinks },
  ] = await Promise.all([
    supabase.from('expenses').select('category, amount, expense_type'),
    supabase
      .from('expense_allocations')
      .select('tree_id, allocation_amount, expenses(expense_type), trees(tree_positions(position_code))'),
    supabase.from('labour_events').select('tree_id, amount, trees(tree_positions(position_code))').not('tree_id', 'is', null),
    zoneIds.length
      ? supabase.from('labour_events').select('zone_id, amount').in('zone_id', zoneIds)
      : Promise.resolve({ data: [] }),
    zoneIds.length
      ? supabase
        .from('tree_irrigation_zones')
        .select('zone_id, tree_id, trees!inner(status, tree_positions(position_code))')
        .in('zone_id', zoneIds)
        .is('end_date', null)
      : Promise.resolve({ data: [] }),
  ]);

  const catMap = {};
  let capex = 0;
  let opex = 0;

  (expenses || []).forEach((e) => {
    addToCategoryMap(catMap, e.category || 'Other', e.amount);
    if (e.expense_type === 'CAPEX') capex += Number(e.amount || 0);
    else opex += Number(e.amount || 0);
  });

  const directLabourTotal = (directLabour || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const zoneLabourTotal = (zoneLabour || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );
  const labourTotal = directLabourTotal + zoneLabourTotal;
  addToCategoryMap(catMap, 'Labour', labourTotal);
  opex += labourTotal;

  const treeMap = {};

  (allocs || []).forEach((row) => {
    if (!row.tree_id) return;
    const code = row.trees?.tree_positions?.position_code;
    const expenseType = row.expenses?.expense_type === 'CAPEX' ? 'CAPEX' : 'OPEX';
    addTreeCost(treeMap, row.tree_id, code, row.allocation_amount, expenseType);
  });

  (directLabour || []).forEach((row) => {
    if (!row.tree_id) return;
    const code = row.trees?.tree_positions?.position_code;
    addTreeCost(treeMap, row.tree_id, code, row.amount, 'OPEX');
  });

  const activeCountByZone = {};
  (zoneTreeLinks || []).forEach((link) => {
    if (link.trees?.status !== 'Active') return;
    activeCountByZone[link.zone_id] = (activeCountByZone[link.zone_id] || 0) + 1;
  });

  (zoneLabour || []).forEach((row) => {
    const activeCount = activeCountByZone[row.zone_id] || 0;
    if (!activeCount) return;
    const share = Number(row.amount || 0) / activeCount;
    (zoneTreeLinks || []).forEach((link) => {
      if (link.zone_id !== row.zone_id || link.trees?.status !== 'Active') return;
      const code = link.trees?.tree_positions?.position_code;
      addTreeCost(treeMap, link.tree_id, code, share, 'OPEX');
    });
  });

  const byCategory = Object.entries(catMap)
    .map(([category, amount]) => ({ category, amount, total: amount }))
    .sort((a, b) => b.amount - a.amount);

  const byTree = Object.values(treeMap)
    .filter((tree) => tree.total > 0)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

  const topTrees = Object.values(treeMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(({ id, code, total }) => ({ id, code, amount: total }));

  return {
    byCategory,
    byTree,
    totals: { capex, opex, total: capex + opex },
    topTrees,
  };
}
