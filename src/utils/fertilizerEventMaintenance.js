export function formatFertilizerProductLines(rows, productKey = 'products') {
  return (rows || [])
    .map((row) => {
      const name = row[productKey]?.name || 'Product';
      const qty = row.quantity != null && row.quantity !== '' ? String(row.quantity) : '';
      return `${name} ${qty} ${row.unit || ''}`.trim();
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
    const job = jobId != null ? byId.get(jobId) : null;
    const fromJob = eventTimesFromJob(job);
    const started_at = event.started_at || fromJob.started_at || null;
    let ended_at = event.ended_at || fromJob.ended_at || null;
    if (!ended_at && started_at && Number(event.duration_minutes) > 0) {
      ended_at = new Date(new Date(started_at).getTime() + Number(event.duration_minutes) * 60000).toISOString();
    }
    const programName = event.program_name
      || job?.irrigation_programs?.name
      || job?.program_name
      || null;
    return { ...event, started_at, ended_at, program_name: programName };
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

function injectorMixQuantity(device, durationMinutes) {
  const flow = Number(device?.fertilizer_flow_lph);
  const minutes = Number(durationMinutes);
  if (flow > 0 && minutes > 0) {
    return { quantity: Number(((flow * minutes) / 60).toFixed(3)), unit: device?.products?.unit || 'L' };
  }
  const tank = Number(device?.tank_capacity_liters);
  if (tank > 0) {
    return { quantity: tank, unit: device?.products?.unit || 'L' };
  }
  return { quantity: 1, unit: device?.products?.unit || null };
}

async function fetchInjectorProductRows(supabase, { programId, jobId, durationMinutes }) {
  const rows = [];
  const seen = new Set();
  const takeDevice = (device) => {
    const productId = Number(device?.product_id);
    if (!productId || seen.has(productId)) return;
    seen.add(productId);
    const qty = injectorMixQuantity(device, durationMinutes);
    rows.push({
      product_id: productId,
      quantity: qty.quantity,
      unit: qty.unit,
      products: device.products || null,
    });
  };

  if (jobId) {
    const { data, error } = await supabase
      .from('irrigation_job_devices')
      .select('irrigation_devices(product_id, fertilizer_flow_lph, tank_capacity_liters, products(name, unit))')
      .eq('job_id', jobId);
    if (!error) {
      (data || []).forEach((row) => takeDevice(row.irrigation_devices));
    }
  }

  if (programId && !rows.length) {
    const { data, error } = await supabase
      .from('irrigation_program_devices')
      .select('irrigation_devices(product_id, fertilizer_flow_lph, tank_capacity_liters, products(name, unit))')
      .eq('program_id', programId);
    if (!error) {
      (data || []).forEach((row) => takeDevice(row.irrigation_devices));
    }
  }

  return rows;
}

export async function fetchFertigationMixRows(supabase, { programId, jobId, durationMinutes }) {
  if (programId) {
    const { data, error } = await supabase
      .from('irrigation_program_products')
      .select('product_id, quantity, unit, products(name)')
      .eq('program_id', programId);
    if (!error && data?.length) return { rows: data, error: null };
    if (error && !/irrigation_program_products/.test(error.message || '')) {
      return { rows: [], error };
    }
  }
  const injectorRows = await fetchInjectorProductRows(supabase, { programId, jobId, durationMinutes });
  return { rows: injectorRows, error: null };
}

export async function copyProgramProductsOntoEvent(supabase, {
  eventId,
  programId,
  jobId,
  existingEvents,
  durationMinutes,
}) {
  if (!eventId || (!programId && !jobId)) return { error: null, inserted: 0, rows: [] };

  const alreadyOnJob = (existingEvents || []).some((event) => {
    if (event.productsInherited) return false;
    if (parseFertigationJobIdFromNotes(event.notes) !== Number(jobId)) return false;
    return (event.fertigation_products || []).length > 0;
  });
  if (alreadyOnJob) return { error: null, inserted: 0, rows: [] };

  const { data: existing } = await supabase
    .from('fertigation_products')
    .select('id')
    .eq('fertigation_event_id', eventId)
    .limit(1);
  if (existing?.length) return { error: null, inserted: 0, rows: [] };

  const mix = await fetchFertigationMixRows(supabase, { programId, jobId, durationMinutes });
  if (mix.error) return { error: mix.error, inserted: 0, rows: mix.rows || [] };
  if (!mix.rows?.length) return { error: null, inserted: 0, rows: [] };

  const { error: insertError } = await supabase.from('fertigation_products').insert(
    mix.rows.map((row) => ({
      fertigation_event_id: eventId,
      product_id: row.product_id,
      quantity: row.quantity,
      unit: row.unit || null,
    })),
  );
  return {
    error: insertError || null,
    inserted: insertError ? 0 : mix.rows.length,
    rows: mix.rows,
  };
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

  const zoneIdSet = new Set((zoneIds || []).map((id) => Number(id)));
  const jobSelect = 'id, zone_id, program_id, job_type, status, completed_at, started_at, updated_at, duration_elapsed_minutes, on_duration_minutes, liters_delivered, current_step_seq, irrigation_programs(name, program_type)';
  let { data: jobs, error: jobsError } = await supabase
    .from('irrigation_jobs')
    .select(jobSelect)
    .eq('farm_id', farmId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(200);
  if (jobsError && /irrigation_programs/.test(jobsError.message || '')) {
    ({ data: jobs, error: jobsError } = await supabase
      .from('irrigation_jobs')
      .select('id, zone_id, program_id, job_type, status, completed_at, started_at, updated_at, duration_elapsed_minutes, on_duration_minutes, liters_delivered, current_step_seq')
      .eq('farm_id', farmId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(200));
  }
  if (jobsError) return { events: attachJobTimesToEvents(events, []), created: 0 };

  const fertigationJobs = (jobs || []).filter((job) => {
    if (job.job_type !== 'fertigation' && job.irrigation_programs?.program_type !== 'fertigation') {
      return false;
    }
    if (job.zone_id && !zoneIdSet.has(Number(job.zone_id))) return false;
    return true;
  });

  const notedKeys = new Set((events || []).map((event) => event.notes).filter(Boolean));

  let created = 0;
  let productError = null;
  for (const job of fertigationJobs) {
    const notes = fertigationJobNotesKey(job);
    if (notedKeys.has(notes)) continue;
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
      notes,
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
      notedKeys.add(notes);
      if (inserted?.id) {
        const copied = await copyProgramProductsOntoEvent(supabase, {
          eventId: inserted.id,
          programId: job.program_id,
          jobId: job.id,
          existingEvents: events,
          durationMinutes: payload.duration_minutes,
        });
        if (copied.error) productError = copied.error;
      }
    }
  }

  if (created) {
    events = await loadFarmFertigationEvents(supabase, zoneIds);
  }

  let productsAdded = 0;
  for (const job of fertigationJobs) {
    const event = events.find((row) => row.notes === fertigationJobNotesKey(job))
      || events.find((row) => parseFertigationJobIdFromNotes(row.notes) === Number(job.id));
    if (!event) continue;
    const duration = Number(event.duration_minutes)
      || Number(job.duration_elapsed_minutes)
      || Number(job.on_duration_minutes)
      || 0;
    const copied = await copyProgramProductsOntoEvent(supabase, {
      eventId: event.id,
      programId: job.program_id,
      jobId: job.id,
      existingEvents: events,
      durationMinutes: duration,
    });
    if (copied.error) productError = copied.error;
    else productsAdded += copied.inserted;
    if (!(event.fertigation_products || []).length && copied.rows?.length) {
      event.fertigation_products = copied.rows;
    }
  }

  if (productsAdded) {
    events = await loadFarmFertigationEvents(supabase, zoneIds);
  }

  events = annotateInheritedFertigationProducts(attachJobTimesToEvents(events, fertigationJobs));
  for (const event of events) {
    if ((event.fertigation_products || []).length) continue;
    const job = fertigationJobs.find((row) => (
      event.notes === fertigationJobNotesKey(row)
      || parseFertigationJobIdFromNotes(event.notes) === Number(row.id)
    ));
    if (!job) continue;
    const mix = await fetchFertigationMixRows(supabase, {
      programId: job.program_id,
      jobId: job.id,
      durationMinutes: event.duration_minutes,
    });
    if (mix.rows?.length) event.fertigation_products = mix.rows;
  }

  return {
    events,
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
