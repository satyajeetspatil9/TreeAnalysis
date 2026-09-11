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

export function parseFertigationJobIdFromNotes(notes) {
  const match = String(notes || '').match(/^irrigation_job:(\d+)/);
  return match ? Number(match[1]) : null;
}

export function eventTimesFromJob(job, fallbackEnd = null) {
  if (!job) return { started_at: null, ended_at: null };
  const started_at = job.started_at || null;
  let ended_at = job.completed_at || fallbackEnd || null;
  if (!ended_at && started_at) {
    const minutes = Number(job.duration_elapsed_minutes) || Number(job.on_duration_minutes) || 0;
    if (minutes > 0) {
      ended_at = new Date(new Date(started_at).getTime() + minutes * 60000).toISOString();
    }
  }
  return { started_at, ended_at };
}

export function attachJobTimesToEvents(events, jobs) {
  const byId = new Map((jobs || []).map((job) => [Number(job.id), job]));
  return (events || []).map((event) => {
    const jobId = parseFertigationJobIdFromNotes(event.notes);
    const fromJob = jobId != null
      ? eventTimesFromJob(byId.get(jobId))
      : { started_at: null, ended_at: null };
    const started_at = event.started_at || fromJob.started_at || null;
    let ended_at = event.ended_at || fromJob.ended_at || null;
    if (!ended_at && started_at && Number(event.duration_minutes) > 0) {
      ended_at = new Date(new Date(started_at).getTime() + Number(event.duration_minutes) * 60000).toISOString();
    }
    return { ...event, started_at, ended_at };
  });
}

export function annotateInheritedFertigationProducts(events) {
  const byJob = new Map();
  (events || []).forEach((event) => {
    if (event.productsInherited) return;
    const jobId = parseFertigationJobIdFromNotes(event.notes);
    if (jobId == null || !(event.fertigation_products || []).length) return;
    if (!byJob.has(jobId)) byJob.set(jobId, event.fertigation_products);
  });
  return (events || []).map((event) => {
    if ((event.fertigation_products || []).length) return event;
    const jobId = parseFertigationJobIdFromNotes(event.notes);
    if (jobId == null || !byJob.has(jobId)) return event;
    return { ...event, fertigation_products: byJob.get(jobId), productsInherited: true };
  });
}

export async function copyProgramProductsOntoEvent(supabase, {
  eventId,
  programId,
  jobId,
  existingEvents,
}) {
  if (!eventId || !programId) return { error: null, inserted: 0 };

  const alreadyOnJob = (existingEvents || []).some((event) => {
    if (parseFertigationJobIdFromNotes(event.notes) !== Number(jobId)) return false;
    return (event.fertigation_products || []).length > 0;
  });
  if (alreadyOnJob) return { error: null, inserted: 0 };

  const { data: existing } = await supabase
    .from('fertigation_products')
    .select('id')
    .eq('fertigation_event_id', eventId)
    .limit(1);
  if (existing?.length) return { error: null, inserted: 0 };

  const { data: rows, error } = await supabase
    .from('irrigation_program_products')
    .select('product_id, quantity, unit')
    .eq('program_id', programId);
  if (error) {
    if (/irrigation_program_products/.test(error.message || '')) return { error: null, inserted: 0 };
    return { error, inserted: 0 };
  }
  if (!rows?.length) return { error: null, inserted: 0 };

  const { error: insertError } = await supabase.from('fertigation_products').insert(
    rows.map((row) => ({
      fertigation_event_id: eventId,
      product_id: row.product_id,
      quantity: row.quantity,
      unit: row.unit || null,
    })),
  );
  return { error: insertError, inserted: insertError ? 0 : rows.length };
}

export async function addProductsToFertigationEvent(supabase, eventId, productRows) {
  if (!eventId || !productRows?.length) return { error: { message: 'Add at least one product.' } };
  return supabase.from('fertigation_products').insert(
    productRows.map((row) => ({
      fertigation_event_id: eventId,
      product_id: Number(row.product_id),
      quantity: Number(row.quantity),
      unit: row.unit || null,
    })),
  );
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
      id, zone_id, event_date, duration_minutes, water_liters, notes, started_at, ended_at,
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
  if (error && /started_at|ended_at/.test(error.message || '')) {
    ({ data, error } = await supabase
      .from('fertigation_events')
      .select(selectWithNotes.replace(', started_at, ended_at', ''))
      .in('zone_id', zoneIds)
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(200));
  }
  if (error) throw error;
  return annotateInheritedFertigationProducts(data || []);
}

function missingTimeColumns(error) {
  return /started_at|ended_at/.test(error?.message || '');
}

/** Write missing fertigation_events for completed fertigation jobs so Monitoring can list them. */
export async function syncCompletedFertigationJobs(supabase, { farmId, zoneIds }) {
  let events = await loadFarmFertigationEvents(supabase, zoneIds);
  if (!farmId || !zoneIds.length) return { events, created: 0 };

  const { data: jobs, error: jobsError } = await supabase
    .from('irrigation_jobs')
    .select('id, zone_id, program_id, status, completed_at, started_at, updated_at, duration_elapsed_minutes, on_duration_minutes, liters_delivered, current_step_seq')
    .eq('farm_id', farmId)
    .eq('job_type', 'fertigation')
    .eq('status', 'completed')
    .in('zone_id', zoneIds)
    .order('completed_at', { ascending: false })
    .limit(100);
  if (jobsError) return { events: attachJobTimesToEvents(events, []), created: 0 };

  const notedJobIds = new Set();
  events.forEach((event) => {
    const jobId = parseFertigationJobIdFromNotes(event.notes);
    if (jobId != null) notedJobIds.add(jobId);
  });

  let created = 0;
  let productError = null;
  for (const job of jobs || []) {
    if (notedJobIds.has(Number(job.id))) continue;
    const duration = Number(job.duration_elapsed_minutes) || Number(job.on_duration_minutes) || 0;
    const liters = Number(job.liters_delivered) || 0;
    const eventDate = kolkataDateKey(job.completed_at || job.started_at || job.updated_at);
    if (!eventDate || !job.zone_id) continue;

    const times = eventTimesFromJob(job, job.updated_at);
    const payload = {
      zone_id: job.zone_id,
      event_date: eventDate,
      duration_minutes: Math.max(1, Math.round(duration || 1)),
      water_liters: liters > 0 ? liters : null,
      notes: fertigationJobNotesKey(job),
      started_at: times.started_at,
      ended_at: times.ended_at,
    };
    let { data: inserted, error: insertError } = await supabase
      .from('fertigation_events')
      .insert(payload)
      .select('id')
      .single();
    if (insertError && /notes/.test(insertError.message || '')) {
      delete payload.notes;
      ({ data: inserted, error: insertError } = await supabase
        .from('fertigation_events')
        .insert(payload)
        .select('id')
        .single());
    }
    if (insertError && missingTimeColumns(insertError)) {
      delete payload.started_at;
      delete payload.ended_at;
      ({ data: inserted, error: insertError } = await supabase
        .from('fertigation_events')
        .insert(payload)
        .select('id')
        .single());
    }
    if (!insertError) {
      created += 1;
      if (inserted?.id && job.program_id) {
        const copied = await copyProgramProductsOntoEvent(supabase, {
          eventId: inserted.id,
          programId: job.program_id,
          jobId: job.id,
          existingEvents: events,
        });
        if (copied.error) productError = copied.error;
      }
    }
  }

  if (created) {
    events = await loadFarmFertigationEvents(supabase, zoneIds);
  }

  let productsAdded = 0;
  for (const job of jobs || []) {
    if (!job.program_id) continue;
    const event = events.find((row) => parseFertigationJobIdFromNotes(row.notes) === Number(job.id));
    if (!event) continue;
    const copied = await copyProgramProductsOntoEvent(supabase, {
      eventId: event.id,
      programId: job.program_id,
      jobId: job.id,
      existingEvents: events,
    });
    if (copied.error) productError = copied.error;
    else productsAdded += copied.inserted;
  }

  if (productsAdded) {
    events = await loadFarmFertigationEvents(supabase, zoneIds);
  }

  return {
    events: annotateInheritedFertigationProducts(attachJobTimesToEvents(events, jobs)),
    created,
    productError,
  };
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
