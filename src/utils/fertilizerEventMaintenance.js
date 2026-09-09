export function formatFertilizerProductLines(rows, productKey = 'products') {
  return (rows || [])
    .map((row) => {
      const name = row[productKey]?.name || 'Product';
      return `${name} ${row.quantity} ${row.unit || ''}`.trim();
    })
    .join(' · ') || '—';
}

export function kolkataDateKey(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return raw;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return raw || null;
  return parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function fertigationJobNotesKey(job) {
  return `irrigation_job:${job.id}:seq:${job.current_step_seq ?? 0}`;
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
  const selectWithNotes = `
      id, zone_id, event_date, duration_minutes, water_liters, notes,
      irrigation_zones(zone_code, flow_rate_lph),
      fertigation_products(id, product_id, quantity, unit, products(name))
    `;
  const selectWithoutNotes = `
      id, zone_id, event_date, duration_minutes, water_liters,
      irrigation_zones(zone_code, flow_rate_lph),
      fertigation_products(id, product_id, quantity, unit, products(name))
    `;
  let { data, error } = await supabase
    .from('fertigation_events')
    .select(selectWithNotes)
    .in('zone_id', zoneIds)
    .order('event_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (error && /notes/.test(error.message || '')) {
    ({ data, error } = await supabase
      .from('fertigation_events')
      .select(selectWithoutNotes)
      .in('zone_id', zoneIds)
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(200));
  }
  if (error) throw error;
  return data || [];
}

/** Write missing fertigation_events for completed fertigation jobs so Monitoring can list them. */
export async function syncCompletedFertigationJobs(supabase, { farmId, zoneIds }) {
  const events = await loadFarmFertigationEvents(supabase, zoneIds);
  if (!farmId || !zoneIds.length) return { events, created: 0 };

  const { data: jobs, error: jobsError } = await supabase
    .from('irrigation_jobs')
    .select('id, zone_id, status, completed_at, started_at, updated_at, duration_elapsed_minutes, on_duration_minutes, liters_delivered, current_step_seq')
    .eq('farm_id', farmId)
    .eq('job_type', 'fertigation')
    .eq('status', 'completed')
    .in('zone_id', zoneIds)
    .order('completed_at', { ascending: false })
    .limit(100);
  if (jobsError) return { events, created: 0 };

  const notedJobIds = new Set();
  events.forEach((event) => {
    const match = String(event.notes || '').match(/^irrigation_job:(\d+)/);
    if (match) notedJobIds.add(Number(match[1]));
  });

  let created = 0;
  for (const job of jobs || []) {
    if (notedJobIds.has(Number(job.id))) continue;
    const duration = Number(job.duration_elapsed_minutes) || Number(job.on_duration_minutes) || 0;
    const liters = Number(job.liters_delivered) || 0;
    const eventDate = kolkataDateKey(job.completed_at || job.started_at || job.updated_at);
    if (!eventDate || !job.zone_id) continue;

    const payload = {
      zone_id: job.zone_id,
      event_date: eventDate,
      duration_minutes: Math.max(1, Math.round(duration || 1)),
      water_liters: liters > 0 ? liters : null,
      notes: fertigationJobNotesKey(job),
    };
    let { error: insertError } = await supabase.from('fertigation_events').insert(payload);
    if (insertError && /notes/.test(insertError.message || '')) {
      delete payload.notes;
      ({ error: insertError } = await supabase.from('fertigation_events').insert(payload));
    }
    if (!insertError) created += 1;
  }

  if (!created) return { events, created: 0 };
  return { events: await loadFarmFertigationEvents(supabase, zoneIds), created };
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
