export function formatFertilizerProductLines(rows, productKey = 'products') {
  return (rows || [])
    .map((row) => {
      const name = row[productKey]?.name || 'Product';
      return `${name} ${row.quantity} ${row.unit || ''}`.trim();
    })
    .join(' · ') || '—';
}

export async function deleteFertigationEvent(supabase, eventId) {
  return supabase.from('fertigation_events').delete().eq('id', eventId);
}

export async function deleteSoilApplicationEvent(supabase, eventId) {
  return supabase.from('soil_application_events').delete().eq('id', eventId);
}

export async function deleteSprayEvent(supabase, eventId) {
  return supabase.from('spray_events').delete().eq('id', eventId);
}

export async function loadFarmFertigationEvents(supabase, zoneIds) {
  if (!zoneIds.length) return [];
  const { data, error } = await supabase
    .from('fertigation_events')
    .select(`
      id, zone_id, event_date, duration_minutes, water_liters,
      irrigation_zones(zone_code),
      fertigation_products(id, product_id, quantity, unit, products(name))
    `)
    .in('zone_id', zoneIds)
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function loadFarmSprayEvents(supabase, zoneIds) {
  if (!zoneIds.length) return [];
  const { data, error } = await supabase
    .from('spray_events')
    .select(`
      id, zone_id, event_date, purpose,
      irrigation_zones(zone_code),
      spray_products(id, product_id, quantity, unit, products(name))
    `)
    .in('zone_id', zoneIds)
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function loadFarmSoilApplicationEvents(supabase, zoneIds) {
  if (!zoneIds.length) return [];
  const { data, error } = await supabase
    .from('soil_application_events')
    .select(`
      id, zone_id, tree_id, event_date, application_method, notes,
      irrigation_zones(zone_code),
      trees(tree_positions(position_code)),
      soil_application_products(id, product_id, quantity, unit, products(name))
    `)
    .or(`zone_id.in.(${zoneIds.join(',')}),tree_id.not.is.null`)
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export function soilApplicationTargetLabel(event) {
  if (event.tree_id) {
    return event.trees?.tree_positions?.position_code || 'Tree';
  }
  return event.irrigation_zones?.zone_code || 'Zone';
}

export const emptyFertigationLineItem = () => ({ product_id: '', quantity: '' });

export const emptySoilLineItem = () => ({ product_id: '', quantity: '' });

export function resetSoilForm(base = {}) {
  return {
    scope: 'zone',
    zone_id: '',
    tree_id: '',
    event_date: new Date().toISOString().slice(0, 10),
    application_method: 'Basin',
    notes: '',
    ...base,
  };
}

export function resetFertigationForm(base = {}) {
  return {
    zone_id: '',
    event_date: new Date().toISOString().slice(0, 10),
    duration_minutes: '45',
    ...base,
  };
}
