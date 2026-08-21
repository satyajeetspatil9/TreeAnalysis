export function perTreeShare(zoneValue, activeTreeCount) {
  const count = Number(activeTreeCount);
  if (!count || count <= 0) return Number(zoneValue) || 0;
  return (Number(zoneValue) || 0) / count;
}

export function eventCostFromProducts(products) {
  return (products || []).reduce(
    (sum, row) => sum + Number(row.quantity || 0) * Number(row.unitCost || 0),
    0
  );
}

export function parseFertilizerEventNote(notes) {
  if (!notes) return null;
  if (notes.startsWith('fertigation_event:')) {
    return { kind: 'fertigation', id: notes.replace('fertigation_event:', '') };
  }
  if (notes.startsWith('soil_application_event:')) {
    return { kind: 'soil', id: notes.replace('soil_application_event:', '') };
  }
  return null;
}

export function fertilizerEventKey(kind, id) {
  return `${kind}-${id}`;
}

export function expenseNoteForEventKey(eventKey) {
  if (eventKey.startsWith('fertigation-')) {
    return `fertigation_event:${eventKey.slice('fertigation-'.length)}`;
  }
  if (eventKey.startsWith('soil-')) {
    return `soil_application_event:${eventKey.slice('soil-'.length)}`;
  }
  return null;
}

export function inventoryReferenceForEventKey(eventKey) {
  if (eventKey.startsWith('fertigation-')) {
    return `fertigation:${eventKey.slice('fertigation-'.length)}`;
  }
  if (eventKey.startsWith('soil-')) {
    return `soil_application:${eventKey.slice('soil-'.length)}`;
  }
  return null;
}

export function eventKeyFromExpenseNote(notes) {
  const parsed = parseFertilizerEventNote(notes);
  return parsed ? fertilizerEventKey(parsed.kind, parsed.id) : null;
}

export function buildLatestUnitCostByProduct(purchaseRows) {
  const map = {};
  (purchaseRows || []).forEach((row) => {
    const productId = String(row.product_id);
    if (map[productId] == null) {
      map[productId] = Number(row.unit_cost || 0);
    }
  });
  return map;
}

export function buildZoneCostByEventFromSources(expenseRows, inventoryUseRows) {
  const map = {};
  const inventorySums = {};

  (inventoryUseRows || []).forEach((row) => {
    const ref = row.reference || '';
    let key = null;
    if (ref.startsWith('fertigation:')) {
      key = fertilizerEventKey('fertigation', ref.slice('fertigation:'.length));
    } else if (ref.startsWith('soil_application:')) {
      key = fertilizerEventKey('soil', ref.slice('soil_application:'.length));
    }
    if (!key) return;
    inventorySums[key] = (inventorySums[key] || 0) + Number(row.total_cost || 0);
  });

  (expenseRows || []).forEach((row) => {
    const key = eventKeyFromExpenseNote(row.notes);
    if (!key) return;
    map[key] = Number(row.amount || 0);
  });

  Object.entries(inventorySums).forEach(([key, amount]) => {
    if (!map[key]) map[key] = amount;
  });

  return map;
}

export function resolveProductUnitCost(product, unitCostByProduct) {
  const fromRow = Number(product.unitCost || 0);
  if (fromRow > 0) return fromRow;
  const fromPurchase = unitCostByProduct?.[String(product.productId)];
  return Number(fromPurchase || 0);
}

export function eventCostFromProductsWithPrices(products, unitCostByProduct) {
  return (products || []).reduce((sum, product) => {
    const unitCost = resolveProductUnitCost(product, unitCostByProduct);
    return sum + Number(product.quantity || 0) * unitCost;
  }, 0);
}

export function buildTreeCostByEvent(allocations) {
  const map = {};
  (allocations || []).forEach((row) => {
    const parsed = parseFertilizerEventNote(row.expenses?.notes);
    if (!parsed) return;
    const key = fertilizerEventKey(parsed.kind, parsed.id);
    map[key] = (map[key] || 0) + Number(row.allocation_amount || 0);
  });
  return map;
}

export function isFertilizerAllocation(row) {
  if (row.expenses?.category === 'Fertilizer') return true;
  return Boolean(parseFertilizerEventNote(row.expenses?.notes));
}

export function sumFertilizerTreeAllocations(allocations) {
  return (allocations || [])
    .filter(isFertilizerAllocation)
    .reduce((sum, row) => sum + Number(row.allocation_amount || 0), 0);
}

export function fertilizerQuantityShare(quantity, event, activeTreeCount) {
  if (event?.isTreeSpecific) return Number(quantity) || 0;
  return perTreeShare(quantity, activeTreeCount);
}

export function resolveEventCosts(
  event,
  activeTreeCount,
  treeCostByEvent,
  zoneCostByEvent = {},
  unitCostByProduct = {}
) {
  const productZoneCost = eventCostFromProductsWithPrices(event.products, unitCostByProduct);
  const recordedZoneCost = Number(zoneCostByEvent[event.key] || 0);
  const allocatedTreeCost = Number(treeCostByEvent[event.key] || 0);

  if (event?.isTreeSpecific) {
    const totalCost = recordedZoneCost || productZoneCost || allocatedTreeCost;
    return {
      zoneCost: totalCost,
      treeCost: allocatedTreeCost || totalCost,
    };
  }

  const zoneCost = recordedZoneCost || productZoneCost
    || (allocatedTreeCost > 0 ? allocatedTreeCost * activeTreeCount : 0);

  const treeCost = allocatedTreeCost
    || perTreeShare(recordedZoneCost || productZoneCost, activeTreeCount);

  return { zoneCost, treeCost };
}

export function computeFertilizerCostTotals(
  events,
  activeTreeCount,
  treeCostByEvent,
  zoneCostByEvent = {},
  unitCostByProduct = {}
) {
  return (events || []).reduce(
    (totals, event) => {
      const { zoneCost, treeCost } = resolveEventCosts(
        event,
        activeTreeCount,
        treeCostByEvent,
        zoneCostByEvent,
        unitCostByProduct
      );
      return {
        zoneCost: totals.zoneCost + zoneCost,
        treeCost: totals.treeCost + treeCost,
      };
    },
    { zoneCost: 0, treeCost: 0 }
  );
}

export function normalizeSoilEvents(events) {
  return (events || []).map((event) => ({
    key: fertilizerEventKey('soil', event.id),
    eventDate: event.event_date,
    type: 'Direct soil',
    method: event.application_method,
    notes: event.notes,
    treeId: event.tree_id || null,
    isTreeSpecific: Boolean(event.tree_id),
    products: (event.soil_application_products || []).map((row) => ({
      id: row.id,
      productId: row.product_id,
      name: row.products?.name || 'Product',
      quantity: Number(row.quantity),
      unit: row.unit || '',
      unitCost: Number(row.unit_cost || 0),
    })),
  }));
}

export function normalizeFertigationEvents(events) {
  return (events || []).map((event) => ({
    key: fertilizerEventKey('fertigation', event.id),
    eventDate: event.event_date,
    type: 'Drip fertigation',
    method: null,
    notes: null,
    waterLiters: event.water_liters,
    durationMinutes: event.duration_minutes,
    products: (event.fertigation_products || []).map((row) => ({
      id: row.id,
      productId: row.product_id,
      name: row.products?.name || 'Product',
      quantity: Number(row.quantity),
      unit: row.unit || '',
      unitCost: 0,
    })),
  }));
}

export function isFertigationAllocation(row) {
  return parseFertilizerEventNote(row.expenses?.notes)?.kind === 'fertigation';
}

export function sumFertigationTreeAllocations(allocations) {
  return (allocations || [])
    .filter(isFertigationAllocation)
    .reduce((sum, row) => sum + Number(row.allocation_amount || 0), 0);
}

export function collectProductIdsFromFertigationEvents(fertigationEvents) {
  const ids = new Set();
  (fertigationEvents || []).forEach((event) => {
    (event.fertigation_products || []).forEach((row) => {
      if (row.product_id) ids.add(row.product_id);
    });
  });
  return [...ids];
}

export function collectProductIdsFromRawEvents(soilEvents, fertigationEvents) {
  const ids = new Set();
  (soilEvents || []).forEach((event) => {
    (event.soil_application_products || []).forEach((row) => {
      if (row.product_id) ids.add(row.product_id);
    });
  });
  (fertigationEvents || []).forEach((event) => {
    (event.fertigation_products || []).forEach((row) => {
      if (row.product_id) ids.add(row.product_id);
    });
  });
  return [...ids];
}

export async function loadFertilizerCostSources(supabase, events, productIds) {
  const expenseNotes = events.map((event) => expenseNoteForEventKey(event.key)).filter(Boolean);
  const inventoryRefs = events.map((event) => inventoryReferenceForEventKey(event.key)).filter(Boolean);

  const requests = [
    expenseNotes.length
      ? supabase.from('expenses').select('amount, notes').in('notes', expenseNotes)
      : Promise.resolve({ data: [] }),
    inventoryRefs.length
      ? supabase
        .from('inventory_transactions')
        .select('reference, total_cost')
        .in('reference', inventoryRefs)
        .in('transaction_type', ['FERTIGATION_USE', 'SOIL_APPLICATION_USE'])
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabase
        .from('inventory_transactions')
        .select('product_id, unit_cost, transaction_date, id')
        .eq('transaction_type', 'PURCHASE')
        .in('product_id', productIds)
        .not('unit_cost', 'is', null)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false })
      : Promise.resolve({ data: [] }),
  ];

  const [{ data: expenseRows }, { data: inventoryUseRows }, { data: purchaseRows }] = await Promise.all(requests);

  return {
    zoneCostByEvent: buildZoneCostByEventFromSources(expenseRows, inventoryUseRows),
    unitCostByProduct: buildLatestUnitCostByProduct(purchaseRows),
  };
}

export function mergeFertilizerEvents(soilEvents, fertigationEvents) {
  return [
    ...normalizeSoilEvents(soilEvents),
    ...normalizeFertigationEvents(fertigationEvents),
  ].sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
}
