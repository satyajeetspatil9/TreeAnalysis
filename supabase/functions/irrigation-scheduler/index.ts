import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FARM_TZ = 'Asia/Kolkata';

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Supabase = ReturnType<typeof createClient>;

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    weekday: weekdayMap[map.weekday] ?? 0,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}:${map.second}`,
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function timeToMinutes(time: string) {
  const [h, m, s] = String(time).split(':').map((v) => Number(v) || 0);
  return h * 60 + m + (s || 0) / 60;
}

function isInsideWindows(
  windows: Array<{ weekday: number; start_time: string; end_time: string; enabled: boolean }>,
  weekday: number,
  hhmmss: string,
) {
  const nowMin = timeToMinutes(hhmmss);
  return windows.some((w) => {
    if (!w.enabled || Number(w.weekday) !== weekday) return false;
    const start = timeToMinutes(w.start_time);
    const end = timeToMinutes(w.end_time);
    return nowMin >= start && nowMin < end;
  });
}

function matchesStartTime(startTimes: string[], hhmm: string) {
  return (startTimes || []).some((t) => String(t).slice(0, 5) === hhmm);
}

function uniqueDeviceCodes(codes: Array<string | null | undefined>) {
  return [...new Set(
    codes
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  )];
}

function deviceCodesFromQueueRow(row: {
  device_code?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const fromPayload = Array.isArray(payload.device_codes) ? payload.device_codes as string[] : [];
  return uniqueDeviceCodes([...fromPayload, row.device_code]);
}

function zoneValveCode(
  devices: Array<{ zone_id?: number | null; kind?: string; is_active?: boolean; device_code?: string | null }>,
  zoneId: number | null | undefined,
) {
  if (!zoneId) return null;
  const valve = devices.find((device) => (
    Number(device.zone_id) === Number(zoneId)
    && device.kind === 'zone_valve'
    && device.is_active !== false
    && device.device_code
  ));
  return valve?.device_code ? String(valve.device_code).trim().toUpperCase() : null;
}

async function enqueueCommand(
  supabase: Supabase,
  farmId: number,
  deviceCode: string,
  action: 'start' | 'stop',
  opts: {
    jobId?: number | null;
    zoneId?: number | null;
    payload?: Record<string, unknown>;
    deviceCodes?: string[];
  } = {},
) {
  const codes = uniqueDeviceCodes(opts.deviceCodes?.length ? opts.deviceCodes : [deviceCode]);
  if (!codes.length) return;

  const { data: pending } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload')
    .eq('farm_id', farmId)
    .eq('action', action)
    .eq('status', 'pending');

  const wanted = codes.slice().sort().join(',');
  const alreadyQueued = (pending || []).some((row) => (
    deviceCodesFromQueueRow(row).slice().sort().join(',') === wanted
  ));
  if (alreadyQueued) return;

  const now = new Date();
  await supabase.from('irrigation_command_queue').insert({
    farm_id: farmId,
    device_code: codes[0],
    action,
    job_id: opts.jobId ?? null,
    zone_id: opts.zoneId ?? null,
    payload: { ...(opts.payload ?? {}), device_codes: codes },
    status: 'pending',
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  });
}

async function enqueueCommandGroup(
  supabase: Supabase,
  farmId: number,
  deviceCodes: string[],
  action: 'start' | 'stop',
  opts: {
    jobId?: number | null;
    zoneId?: number | null;
    payload?: Record<string, unknown>;
  } = {},
) {
  const codes = uniqueDeviceCodes(deviceCodes);
  if (!codes.length) return;
  await enqueueCommand(supabase, farmId, codes[0], action, { ...opts, deviceCodes: codes });
}

async function cancelPendingForDevices(
  supabase: Supabase,
  farmId: number,
  deviceCodes: string[],
) {
  const codes = uniqueDeviceCodes(deviceCodes);
  if (!codes.length) return;
  const wanted = new Set(codes);
  const { data: pending } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload')
    .eq('farm_id', farmId)
    .eq('status', 'pending');
  const ids = (pending || [])
    .filter((row) => deviceCodesFromQueueRow(row).some((code) => wanted.has(code)))
    .map((row) => row.id);
  if (!ids.length) return;
  await supabase
    .from('irrigation_command_queue')
    .update({ status: 'cancelled' })
    .in('id', ids);
}

async function resolveStepTargetLiters(
  step: {
    target_liters: number | null;
    on_duration_minutes: number | null;
    zone_id: number | null;
  },
) {
  if (step.target_liters != null) return Number(step.target_liters);
  return null;
}

function resolveStepDuration(step: { on_duration_minutes: number | null }) {
  return step.on_duration_minutes != null && Number(step.on_duration_minutes) > 0
    ? Number(step.on_duration_minutes)
    : null;
}

async function createJobFromProgram(
  supabase: Supabase,
  farmId: number,
  program: Record<string, unknown>,
  steps: Array<Record<string, unknown>>,
  programDevices: Array<Record<string, unknown>>,
  zonesById: Map<number, { id: number; zone_code: string; flow_rate_lph: number | null }>,
  scheduledFor: string,
) {
  const activeSteps = steps
    .filter((s) => s.is_active !== false)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  if (!activeSteps.length) return null;

  // Skip if this program already has an incomplete job
  const { data: openForProgram } = await supabase
    .from('irrigation_jobs')
    .select('id')
    .eq('farm_id', farmId)
    .eq('program_id', program.id as number)
    .in('status', ['planned', 'running', 'paused_outside_window'])
    .limit(1);
  if (openForProgram?.length) return null;

  // Farm-wide: only one watering/fertigation job at a time (programs run sequentially)
  const { data: openFarmJobs } = await supabase
    .from('irrigation_jobs')
    .select('id')
    .eq('farm_id', farmId)
    .in('job_type', ['water', 'fertigation', 'manual'])
    .in('status', ['planned', 'running', 'paused_outside_window'])
    .limit(1);
  if (openFarmJobs?.length) return null;

  const first = activeSteps[0] as {
    id: number;
    zone_id: number | null;
    seq: number;
    target_liters: number | null;
    on_duration_minutes: number | null;
  };
  const isFertigation = program.program_type === 'fertigation';
  const target = isFertigation
    ? null
    : await resolveStepTargetLiters(first);
  const duration = isFertigation ? resolveStepDuration(first) : null;

  const now = new Date().toISOString();
  const { data: job, error } = await supabase
    .from('irrigation_jobs')
    .insert({
      farm_id: farmId,
      program_id: program.id,
      program_step_id: first.id,
      zone_id: first.zone_id,
      job_type: isFertigation ? 'fertigation' : 'water',
      status: 'planned',
      target_liters: target,
      on_duration_minutes: duration,
      duration_elapsed_minutes: 0,
      liters_delivered: 0,
      current_step_seq: Number(first.seq) || 0,
      window_mode: true,
      scheduled_for: scheduledFor,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !job) return null;

  const deviceRows: Array<{ job_id: number; device_id: number; role: string }> = [];
  (programDevices || []).forEach((d) => {
    if (d.device_id == null) return;
    deviceRows.push({
      job_id: job.id,
      device_id: Number(d.device_id),
      role: String(d.role || 'injector'),
    });
  });
  (program.motor_device_ids as number[] || []).forEach((id) => {
    if (!id || deviceRows.some((row) => Number(row.device_id) === Number(id))) return;
    deviceRows.push({ job_id: job.id, device_id: Number(id), role: 'motor' });
  });
  if (deviceRows.length) {
    await supabase.from('irrigation_job_devices').insert(deviceRows);
  }

  return job;
}

async function advanceOrCompleteJob(
  supabase: Supabase,
  job: Record<string, unknown>,
  steps: Array<Record<string, unknown>>,
  zonesById: Map<number, { id: number; zone_code: string; flow_rate_lph: number | null }>,
) {
  const activeSteps = steps
    .filter((s) => s.is_active !== false)
    .sort((a, b) => Number(a.seq) - Number(b.seq));
  const currentIdx = activeSteps.findIndex((s) => Number(s.seq) === Number(job.current_step_seq));
  const next = currentIdx >= 0 ? activeSteps[currentIdx + 1] : null;

  if (!next) {
    await supabase.from('irrigation_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    return null;
  }

  const nextStep = next as {
    id: number;
    zone_id: number | null;
    seq: number;
    target_liters: number | null;
    on_duration_minutes: number | null;
  };
  const isFertigation = job.job_type === 'fertigation';
  const target = isFertigation
    ? null
    : await resolveStepTargetLiters(nextStep);
  const duration = isFertigation ? resolveStepDuration(nextStep) : null;

  const { data: updated } = await supabase.from('irrigation_jobs').update({
    program_step_id: next.id,
    zone_id: next.zone_id,
    current_step_seq: Number(next.seq) || 0,
    target_liters: target,
    on_duration_minutes: duration,
    duration_elapsed_minutes: 0,
    liters_delivered: 0,
    liters_baseline: null,
    status: 'planned',
    started_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id).select('*').single();

  return updated;
}

async function recordWaterIrrigationEvent(
  supabase: Supabase,
  job: Record<string, unknown>,
  zone: { id: number; flow_rate_lph: number | null } | undefined,
  now: Date,
) {
  if (!job.zone_id) return;
  if (job.job_type === 'fertigation') return;

  const liters = Number(job.liters_delivered) || Number(job.target_liters) || 0;
  const flow = zone?.flow_rate_lph != null ? Number(zone.flow_rate_lph) : null;
  let duration = Number(job.duration_elapsed_minutes) || 0;
  if (!(duration > 0) && liters > 0 && flow && flow > 0) {
    duration = (liters / flow) * 60;
  }
  if (!(duration > 0) && job.started_at) {
    duration = Math.max(0, (now.getTime() - new Date(String(job.started_at)).getTime()) / 60000);
  }
  if (!(duration > 0) && !(liters > 0)) return;

  const local = partsInTz(now, FARM_TZ);
  const notes = `irrigation_job:${job.id}:seq:${job.current_step_seq ?? 0}`;
  const { data: existing } = await supabase
    .from('irrigation_events')
    .select('id')
    .eq('zone_id', job.zone_id)
    .eq('notes', notes)
    .maybeSingle();
  if (existing) return;

  await supabase.from('irrigation_events').insert({
    zone_id: job.zone_id,
    event_date: local.dateKey,
    duration_minutes: Math.max(1, Math.round(duration)),
    water_liters: liters > 0 ? liters : null,
    flow_rate_lph: flow,
    notes,
  });
}

async function processFarm(supabase: Supabase, farmId: number, now: Date) {
  const local = partsInTz(now, FARM_TZ);
  const actions: string[] = [];

  const [
    { data: windows },
    { data: programs },
    { data: jobs },
    { data: devices },
    { data: zones },
    { data: schedules },
    { data: statusRows },
  ] = await Promise.all([
    supabase.from('irrigation_allowed_windows').select('*').eq('farm_id', farmId),
    supabase.from('irrigation_programs').select('*').eq('farm_id', farmId).eq('is_active', true),
    supabase.from('irrigation_jobs').select('*').eq('farm_id', farmId)
      .in('status', ['planned', 'running', 'paused_outside_window']),
    supabase.from('irrigation_devices').select('*').eq('farm_id', farmId).eq('is_active', true),
    supabase.from('irrigation_zones').select('id, zone_code, flow_rate_lph').eq('farm_id', farmId),
    supabase.from('irrigation_device_schedules').select('*, irrigation_devices(device_code, kind)')
      .eq('farm_id', farmId).eq('enabled', true),
    supabase.from('irrigation_zone_status').select('zone_id, device_code, total_discharge_liters, is_irrigating')
      .eq('farm_id', farmId),
  ]);

  const zonesById = new Map((zones || []).map((z) => [z.id, z]));
  const devicesById = new Map((devices || []).map((d) => [d.id, d]));
  const statusByZone = new Map((statusRows || []).map((s) => [s.zone_id, s]));
  const inWindow = isInsideWindows(windows || [], local.weekday, local.timeStr);

  const sortedPrograms = [...(programs || [])].sort((a, b) => {
    const orderA = Number(a.run_order) || 0;
    const orderB = Number(b.run_order) || 0;
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.id) - Number(b.id);
  });

  // Create at most one new job: next program in run_order that is due and has no open farm job
  const { data: anyOpen } = await supabase
    .from('irrigation_jobs')
    .select('id')
    .eq('farm_id', farmId)
    .in('job_type', ['water', 'fertigation', 'manual'])
    .in('status', ['planned', 'running', 'paused_outside_window'])
    .limit(1);

  if (!anyOpen?.length) {
    const dayStart = `${local.dateKey}T00:00:00+05:30`;
    const dayEnd = `${local.dateKey}T23:59:59+05:30`;

    for (const program of sortedPrograms) {
      const days: number[] = program.days_of_week || [];
      if (days.length && !days.map(Number).includes(local.weekday)) continue;

      const startTimes: string[] = program.start_times || [];
      const startPassedOrNow = startTimes.length === 0
        || startTimes.some((t) => {
          const hhmm = String(t).slice(0, 5);
          return hhmm <= local.hhmm;
        });
      const matchesExact = matchesStartTime(startTimes, local.hhmm);

      const shouldFireTimed = !program.use_allowed_windows && (matchesExact || startPassedOrNow);
      const shouldFireWindow = program.use_allowed_windows && inWindow
        && (matchesExact || startPassedOrNow || startTimes.length === 0);

      if (!(shouldFireTimed || shouldFireWindow)) continue;

      // Skip if this program already completed a job today
      const { data: doneToday } = await supabase
        .from('irrigation_jobs')
        .select('id')
        .eq('farm_id', farmId)
        .eq('program_id', program.id)
        .eq('status', 'completed')
        .gte('completed_at', dayStart)
        .lte('completed_at', dayEnd)
        .limit(1);
      if (doneToday?.length) continue;

      const [{ data: steps }, { data: progDevices }] = await Promise.all([
        supabase.from('irrigation_program_steps').select('*').eq('program_id', program.id),
        supabase.from('irrigation_program_devices').select('*').eq('program_id', program.id),
      ]);

      const job = await createJobFromProgram(
        supabase,
        farmId,
        program,
        steps || [],
        progDevices || [],
        zonesById,
        now.toISOString(),
      );
      if (job) {
        actions.push(`created_job:${job.id}:program:${program.id}`);
        break; // only one program at a time
      }
    }
  }

  // Refresh open jobs after possible creates
  const { data: openJobs } = await supabase
    .from('irrigation_jobs')
    .select('*')
    .eq('farm_id', farmId)
    .in('status', ['planned', 'running', 'paused_outside_window']);

  // Only one job may actively water: manual/quick jobs first, then program run_order
  const programOrder = new Map(sortedPrograms.map((p, idx) => [p.id, Number(p.run_order) || idx]));
  const sortedOpenJobs = [...(openJobs || [])].sort((a, b) => {
    const manualA = a.job_type === 'manual' ? 0 : 1;
    const manualB = b.job_type === 'manual' ? 0 : 1;
    if (manualA !== manualB) return manualA - manualB;
    const oa = programOrder.get(a.program_id) ?? 9999;
    const ob = programOrder.get(b.program_id) ?? 9999;
    if (oa !== ob) return oa - ob;
    return Number(a.id) - Number(b.id);
  });
  const primaryJob = sortedOpenJobs.find((j) => j.job_type === 'manual')
    || sortedOpenJobs.find((j) => j.status === 'running')
    || sortedOpenJobs[0]
    || null;

  for (const job of sortedOpenJobs) {
    const isPrimary = primaryJob && job.id === primaryJob.id;

    const zone = job.zone_id ? zonesById.get(job.zone_id) : null;
    const status = job.zone_id ? statusByZone.get(job.zone_id) : null;
    const valveCode = zoneValveCode(devices || [], job.zone_id);

    const { data: jobDevices } = await supabase
      .from('irrigation_job_devices')
      .select('device_id, role')
      .eq('job_id', job.id);

    const motorIds: number[] = [];
    if (job.program_id) {
      const prog = sortedPrograms.find((p) => p.id === job.program_id);
      if (prog?.motor_device_ids?.length) motorIds.push(...prog.motor_device_ids.map(Number));
    }

    const extraCodes = [
      ...(jobDevices || []).map((jd) => devicesById.get(jd.device_id)?.device_code).filter(Boolean),
      ...motorIds.map((id) => devicesById.get(id)?.device_code).filter(Boolean),
    ].map((c) => String(c).toUpperCase());

    const allCodes = uniqueDeviceCodes([valveCode, ...extraCodes]);

    const stopAll = async (reason?: string) => {
      await cancelPendingForDevices(supabase, farmId, allCodes);
      await enqueueCommandGroup(supabase, farmId, allCodes, 'stop', {
        jobId: job.id,
        zoneId: job.zone_id,
        payload: reason ? { reason } : {},
      });
      if (job.zone_id) {
        await supabase.from('irrigation_zone_status').update({
          pending_command: 'stop',
          pending_command_at: now.toISOString(),
          updated_at: now.toISOString(),
        }).eq('zone_id', job.zone_id);
      }
    };

    // Non-primary jobs must wait (do not start another program/zone while one is active)
    if (!isPrimary) {
      if (job.status === 'running') {
        await stopAll('queued_behind_primary');
        await supabase.from('irrigation_jobs').update({
          status: 'planned',
          liters_baseline: null,
          updated_at: now.toISOString(),
        }).eq('id', job.id);
        actions.push(`queued_behind_primary:${job.id}`);
      }
      continue;
    }

    // Update liters from telemetry if baseline set
    if (status?.total_discharge_liters != null && job.liters_baseline != null) {
      const delivered = Math.max(
        0,
        Number(status.total_discharge_liters) - Number(job.liters_baseline),
      );
      if (delivered !== Number(job.liters_delivered)) {
        await supabase.from('irrigation_jobs').update({
          liters_delivered: delivered,
          updated_at: now.toISOString(),
        }).eq('id', job.id);
        job.liters_delivered = delivered;
      }
    }

    const target = job.target_liters != null ? Number(job.target_liters) : null;
    const durationMinutes = job.on_duration_minutes != null ? Number(job.on_duration_minutes) : null;
    const delivered = Number(job.liters_delivered) || 0;

    if (job.status === 'running' && durationMinutes != null) {
      const last = new Date(String(job.updated_at || job.started_at || now.toISOString())).getTime();
      const deltaMin = Math.max(0, (now.getTime() - last) / 60000);
      const elapsed = Number(job.duration_elapsed_minutes || 0) + deltaMin;
      await supabase.from('irrigation_jobs').update({
        duration_elapsed_minutes: elapsed,
        updated_at: now.toISOString(),
      }).eq('id', job.id);
      job.duration_elapsed_minutes = elapsed;
    }

    const hitLiters = target != null && delivered >= target;
    const hitDuration = durationMinutes != null
      && Number(job.duration_elapsed_minutes || 0) >= durationMinutes;
    const hitTarget = hitLiters || hitDuration;
    const windowBlocks = job.window_mode && !inWindow && job.job_type !== 'manual';

    if (hitTarget) {
      await recordWaterIrrigationEvent(supabase, job, zone, now);
      await stopAll('target_reached');

      let steps: Array<Record<string, unknown>> = [];
      if (job.program_id) {
        const { data } = await supabase
          .from('irrigation_program_steps')
          .select('*')
          .eq('program_id', job.program_id);
        steps = data || [];
      }

      if (steps.length > 1) {
        const advanced = await advanceOrCompleteJob(supabase, job, steps, zonesById);
        actions.push(advanced
          ? `advanced_job:${job.id}:seq:${advanced.current_step_seq}`
          : `completed_job:${job.id}`);
      } else {
        await supabase.from('irrigation_jobs').update({
          status: 'completed',
          completed_at: now.toISOString(),
          updated_at: now.toISOString(),
        }).eq('id', job.id);
        actions.push(`completed_job:${job.id}`);
      }
      continue;
    }

    if (windowBlocks) {
      if (job.status === 'running') {
        await stopAll('outside_window');
        await supabase.from('irrigation_jobs').update({
          status: 'paused_outside_window',
          liters_baseline: null,
          updated_at: now.toISOString(),
        }).eq('id', job.id);
        actions.push(`paused_job:${job.id}`);
      }
      continue;
    }

    // Inside window (or no window mode): start all selected terminals together
    const untilPayload = durationMinutes != null
      ? { until: { minutes: durationMinutes } }
      : (target != null ? { until: { liters: target } } : {});

    const becomingRunning = job.status === 'planned' || job.status === 'paused_outside_window';
    if (becomingRunning) {
      if (!allCodes.length) {
        actions.push(`skip_start_no_terminals:${job.id}`);
        continue;
      }
      const baseline = status?.total_discharge_liters != null
        ? Number(status.total_discharge_liters)
        : 0;
      await supabase.from('irrigation_jobs').update({
        status: 'running',
        started_at: job.started_at || now.toISOString(),
        liters_baseline: baseline,
        updated_at: now.toISOString(),
      }).eq('id', job.id);

      await enqueueCommandGroup(supabase, farmId, allCodes, 'start', {
        jobId: job.id,
        zoneId: job.zone_id,
        payload: untilPayload,
      });

      if (job.zone_id) {
        const { data: existingStatus } = await supabase
          .from('irrigation_zone_status')
          .select('zone_id')
          .eq('zone_id', job.zone_id)
          .maybeSingle();
        if (existingStatus) {
          await supabase.from('irrigation_zone_status').update({
            pending_command: 'start',
            pending_command_at: now.toISOString(),
            updated_at: now.toISOString(),
          }).eq('zone_id', job.zone_id);
        } else {
          await supabase.from('irrigation_zone_status').insert({
            zone_id: job.zone_id,
            farm_id: farmId,
            is_irrigating: false,
            pending_command: 'start',
            pending_command_at: now.toISOString(),
            updated_at: now.toISOString(),
            reported_at: now.toISOString(),
          });
        }
      }
      actions.push(`ensure_start_job:${job.id}:codes:${allCodes.join(',')}`);
    }
  }

  // Device schedules (non-volume weekly on/off)
  for (const sched of schedules || []) {
    if (Number(sched.weekday) !== local.weekday) continue;
    const deviceCode = (sched.irrigation_devices as { device_code?: string } | null)?.device_code;
    if (!deviceCode) continue;

    const nowMin = timeToMinutes(local.timeStr);
    const start = timeToMinutes(sched.start_time);
    const end = timeToMinutes(sched.end_time);
    const inside = nowMin >= start && nowMin < end;

    // Cyclic bore mode: within window, alternate on/off by minutes
    if (inside && sched.cyclic_on_minutes && sched.cyclic_off_minutes) {
      const cycle = Number(sched.cyclic_on_minutes) + Number(sched.cyclic_off_minutes);
      const elapsed = Math.floor(nowMin - start);
      const phase = ((elapsed % cycle) + cycle) % cycle;
      const shouldOn = phase < Number(sched.cyclic_on_minutes);
      await enqueueCommand(supabase, farmId, deviceCode, shouldOn ? 'start' : 'stop', {});
      actions.push(`cyclic:${deviceCode}:${shouldOn ? 'on' : 'off'}`);
      continue;
    }

    if (inside && matchesStartTime([sched.start_time], local.hhmm)) {
      await enqueueCommand(supabase, farmId, deviceCode, 'start', {});
      actions.push(`sched_start:${deviceCode}`);
    }
    if (!inside && matchesStartTime([sched.end_time], local.hhmm)) {
      await enqueueCommand(supabase, farmId, deviceCode, 'stop', {});
      actions.push(`sched_stop:${deviceCode}`);
    }
    // Also ensure stop if past end
    if (!inside && nowMin >= end && nowMin < end + 1) {
      await enqueueCommand(supabase, farmId, deviceCode, 'stop', {});
    }
  }

  return { farmId, inWindow, weekday: local.weekday, time: local.hhmm, actions };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('IRRIGATION_SCHEDULER_CRON_SECRET')
    || Deno.env.get('GPS_SATELLITE_CRON_SECRET')
    || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const provided = req.headers.get('x-cron-secret') || '';
  if (cronSecret && provided !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const farmIdFilter = body.farm_id != null ? Number(body.farm_id) : null;

  let farmIds: number[] = [];
  if (farmIdFilter) {
    farmIds = [farmIdFilter];
  } else {
    const { data: farms } = await supabase.from('farms').select('id');
    farmIds = (farms || []).map((f) => f.id);
  }

  const results = [];
  for (const farmId of farmIds) {
    try {
      results.push(await processFarm(supabase, farmId, now));
    } catch (err) {
      results.push({ farmId, error: String(err) });
    }
  }

  return jsonResponse({
    ok: true,
    ran_at: now.toISOString(),
    farms: results.length,
    results,
  });
});
