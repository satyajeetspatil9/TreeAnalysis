import { supabase } from '../supabaseClient';
import { sendIrrigationCommandPayload } from './irrigationStatus';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DEVICE_KIND_OPTIONS = [
  { value: 'zone_valve', label: 'Zone valve' },
  { value: 'irrigation_motor', label: 'Irrigation motor' },
  { value: 'bore_motor', label: 'Bore motor' },
  { value: 'fertigation', label: 'Fertigation injector' },
  { value: 'other', label: 'Other device' },
];

export const DEVICE_IO_OPTIONS = [
  { value: 'output', label: 'Output (Y)' },
  { value: 'input', label: 'Input (X)' },
];

/** Controller terminals per direction: X0…X8 for inputs, Y0…Y8 for outputs. */
export const CONTROLLER_PIN_COUNT = 9;

export function controllerPinOptions(ioType) {
  const prefix = ioType === 'input' ? 'X' : 'Y';
  return Array.from({ length: CONTROLLER_PIN_COUNT }, (_, i) => `${prefix}${i}`);
}

export function ioTypeFromDeviceCode(deviceCode) {
  const code = String(deviceCode || '').trim().toUpperCase();
  if (/^X\d+$/.test(code)) return 'input';
  if (/^Y\d+$/.test(code)) return 'output';
  return null;
}

export function ioTypeLabel(ioType) {
  return ioType === 'input' ? 'Input' : 'Output';
}

/** Job statuses that still hold a place in the farm queue. */
export const OPEN_JOB_STATUSES = [
  'planned',
  'running',
  'paused_outside_window',
  'paused_no_power',
];

/** Controller terminals: X0–X8 sense inputs, Y0–Y8 driven outputs. */
const TERMINAL_PATTERN = /^[XY]\d+$/;

export function isControllerTerminal(code) {
  return TERMINAL_PATTERN.test(String(code || '').trim().toUpperCase());
}

export function isMissingScheduleTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /irrigation_(devices|allowed_windows|programs|jobs|command_queue|device_schedules|power_status)/.test(message);
}

export function scheduleTableHint(message) {
  if (!message) return message;
  if (/irrigation_power_status/.test(message)
    || /paused_no_power/.test(message)
    || /max_duration_minutes/.test(message)
    || /shift_minutes/.test(message)
    || /outage_started_at/.test(message)
    || /outage_ended_at/.test(message)) {
    return `${message} Run migration 047_irrigation_controller_outage_times.sql (or 046) in Supabase SQL Editor.`;
  }
  if (/duration_elapsed_minutes/.test(message) || /column .*on_duration_minutes.*irrigation_jobs/.test(message)) {
    return `${message} Run migration 043_irrigation_job_duration.sql in Supabase SQL Editor.`;
  }
  if (/irrigation_events.*notes/.test(message) || /column .*notes.*irrigation_events/.test(message)) {
    return `${message} Run migration 044_irrigation_event_notes.sql in Supabase SQL Editor.`;
  }
  if (/io_type/.test(message)) {
    return `${message} Run migration 042_irrigation_device_io.sql in Supabase SQL Editor.`;
  }
  if (/irrigation_/.test(message)) {
    return `${message} Run migration 039_irrigation_schedule_control.sql in Supabase SQL Editor.`;
  }
  return message;
}

/** Estimate minutes from liters and flow L/h */
export function estimateMinutesFromLiters(targetLiters, flowRateLph) {
  const liters = Number(targetLiters);
  const flow = Number(flowRateLph);
  if (!liters || !flow || flow <= 0) return null;
  return Math.round((liters / flow) * 60);
}

export function estimateLitersFromMinutes(minutes, flowRateLph) {
  const mins = Number(minutes);
  const flow = Number(flowRateLph);
  if (!mins || !flow || flow <= 0) return null;
  return Math.round((flow * mins) / 60);
}

export function formatTimeInput(value) {
  if (!value) return '';
  const text = String(value);
  return text.length >= 5 ? text.slice(0, 5) : text;
}

export function timeToInputValue(time) {
  return formatTimeInput(time) || '06:00';
}

export function uniqueDeviceCodes(codes) {
  return [...new Set(
    (codes || [])
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  )];
}

/** Same as uniqueDeviceCodes but drops anything that is not a real terminal. */
export function uniqueTerminalCodes(codes) {
  return uniqueDeviceCodes(codes).filter(isControllerTerminal);
}

export function deviceCodesFromQueueRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const fromPayload = Array.isArray(payload.device_codes) ? payload.device_codes : [];
  return uniqueTerminalCodes([...fromPayload, row?.device_code]);
}

export function zoneValveDeviceCode(devices, zoneId) {
  if (!zoneId) return null;
  const valve = (devices || []).find((device) => (
    Number(device.zone_id) === Number(zoneId)
    && device.kind === 'zone_valve'
    && device.is_active !== false
    && device.device_code
  ));
  return valve?.device_code ? String(valve.device_code).trim().toUpperCase() : null;
}

export async function fetchZoneValveDeviceCode(farmId, zoneId) {
  if (!farmId || !zoneId) return null;
  const { data } = await supabase
    .from('irrigation_devices')
    .select('device_code')
    .eq('farm_id', farmId)
    .eq('zone_id', zoneId)
    .eq('kind', 'zone_valve')
    .eq('is_active', true)
    .limit(1);
  const code = data?.[0]?.device_code;
  return code ? String(code).trim().toUpperCase() : null;
}

/**
 * Every terminal a job drives, motors first so firmware that reads only the
 * first command still switches the pump on.
 */
export async function fetchJobTerminalCodes(farmId, job) {
  if (!job) return [];

  const [{ data: jobDevices }, program] = await Promise.all([
    supabase.from('irrigation_job_devices').select('device_id').eq('job_id', job.id),
    job.program_id
      ? supabase
        .from('irrigation_programs')
        .select('motor_device_ids')
        .eq('id', job.program_id)
        .maybeSingle()
        .then(({ data }) => data)
      : Promise.resolve(null),
  ]);

  const deviceIds = [
    ...(jobDevices || []).map((row) => row.device_id),
    ...(program?.motor_device_ids || []),
  ].filter(Boolean);

  const [valveCode, { data: devices }] = await Promise.all([
    fetchZoneValveDeviceCode(farmId, job.zone_id),
    deviceIds.length
      ? supabase.from('irrigation_devices').select('device_code, kind').in('id', [...new Set(deviceIds)])
      : Promise.resolve({ data: [] }),
  ]);

  const motors = (devices || []).filter((d) => String(d.kind || '').includes('motor'));
  const others = (devices || []).filter((d) => !String(d.kind || '').includes('motor') && d.kind !== 'zone_valve');

  return uniqueTerminalCodes([
    ...motors.map((d) => d.device_code),
    ...others.map((d) => d.device_code),
    valveCode,
  ]);
}

/**
 * One command per terminal, each with its own stop rule. Terminals in the same
 * job no longer share an `until`, so a valve on litres and a motor on minutes
 * can finish independently.
 */
export function expandQueueRowToGetCommands(row, zoneCodeById) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const zoneCode = row.zone_id ? (zoneCodeById.get(row.zone_id) || null) : null;

  return deviceCodesFromQueueRow(row).map((code) => ({
    id: row.id,
    device_code: code,
    device_codes: [code],
    action: row.action,
    job_id: row.job_id,
    zone_id: row.zone_id,
    zone_code: zoneCode,
    until: payload.until ?? undefined,
    payload,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }));
}

export function expandQueuedCommands(rows, zoneCodeById) {
  return (rows || []).flatMap((row) => expandQueueRowToGetCommands(row, zoneCodeById));
}

export function buildLiveGetCommandJson({
  commands = [],
  pendingCommands = [],
  powerPresent = true,
  powerReportedAt = null,
}) {
  return JSON.stringify({
    ok: true,
    updated_at: new Date().toISOString(),
    power_present: powerPresent,
    power_reported_at: powerReportedAt,
    commands,
    pending_commands: pendingCommands,
    queue_available: true,
  }, null, 2);
}

export function buildLivePostTelemetryJson(rows = [], { emptyNote } = {}) {
  const bodies = (rows || [])
    .filter((row) => row.status)
    .map(({ zone, status }) => ({
      zone_code: zone.zone_code,
      is_irrigating: Boolean(status.is_irrigating),
      started_at: status.started_at,
      reported_at: status.reported_at,
      voltage_v: status.voltage_v,
      current_amp: status.current_amp,
      start_indicator: Boolean(status.start_indicator),
      stop_indicator: Boolean(status.stop_indicator),
      current_discharge_lpm: status.current_discharge_lpm,
      total_discharge_liters: status.total_discharge_liters,
      device_code: status.device_code,
      power_present: true,
      outage_started_at: null,
      outage_ended_at: null,
      ack_command: Boolean(status.pending_command),
    }));

  if (!bodies.length) {
    return JSON.stringify({
      note: emptyNote
        || 'No telemetry received yet. Controller POST body will look like this once a zone reports.',
      zone_code: 'Z01',
      is_irrigating: false,
      reported_at: new Date().toISOString(),
      voltage_v: null,
      current_amp: null,
      start_indicator: false,
      stop_indicator: false,
      current_discharge_lpm: null,
      total_discharge_liters: null,
      device_code: 'Y0',
      power_present: true,
      outage_started_at: null,
      outage_ended_at: null,
    }, null, 2);
  }

  return JSON.stringify(bodies.length === 1 ? bodies[0] : bodies, null, 2);
}

export function buildCommandQueueSampleJson() {
  const now = new Date().toISOString();
  return JSON.stringify({
    ok: true,
    updated_at: now,
    power_present: true,
    power_reported_at: now,
    commands: [
      {
        id: 101,
        device_code: 'Y0',
        device_codes: ['Y0'],
        action: 'start',
        job_id: 12,
        zone_code: null,
        until: { minutes: 90 },
        payload: { device_codes: ['Y0'], until: { minutes: 90 }, role: 'irrigation_motor' },
      },
      {
        id: 102,
        device_code: 'Y2',
        device_codes: ['Y2'],
        action: 'start',
        job_id: 12,
        zone_code: 'Z01',
        until: { liters: 3000, minutes: 90 },
        payload: { device_codes: ['Y2'], until: { liters: 3000, minutes: 90 }, role: 'zone_valve' },
      },
      {
        id: 103,
        device_code: 'Y4',
        device_codes: ['Y4'],
        action: 'start',
        job_id: null,
        zone_code: null,
        until: { minutes: 480 },
        payload: { device_codes: ['Y4'], until: { minutes: 480 }, reason: 'device_schedule' },
      },
    ],
    pending_commands: [
      { zone_code: 'Z01', command: 'start', command_at: now },
    ],
  }, null, 2);
}

/** Mains presence for the farm. Missing row means the controller never reported. */
export async function fetchPowerStatus(farmId) {
  if (!farmId) return { power: null, error: null };
  const { data, error } = await supabase
    .from('irrigation_power_status')
    .select('power_present, changed_at, reported_at, shift_minutes, local_date, outage_started_at, outage_ended_at')
    .eq('farm_id', farmId)
    .maybeSingle();
  if (error && !isMissingScheduleTable(error)) return { power: null, error };
  return { power: data || null, error: null };
}

export function powerStatusLabel(power) {
  if (!power) return 'Controller has not reported mains power yet';
  if (power.power_present === false) {
    const since = power.changed_at
      ? new Date(power.changed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : null;
    return since
      ? `Mains power OFF since ${since} — programs paused, they resume automatically`
      : 'Mains power OFF — programs paused, they resume automatically';
  }
  return 'Mains power ON';
}

/**
 * Queue one row per controller terminal. Each row carries its own stop rule, so
 * the motor and the zone valve of the same job can end for different reasons.
 * `untilFor` may return a different `until` per terminal.
 */
export async function enqueueIrrigationCommand({
  farmId,
  deviceCode,
  deviceCodes = null,
  action,
  jobId = null,
  zoneId = null,
  payload = {},
  untilFor = null,
  expiresInMinutes = 30,
}) {
  const codes = uniqueTerminalCodes(deviceCodes?.length ? deviceCodes : [deviceCode]);
  if (!codes.length) {
    return {
      data: null,
      error: { message: 'No controller terminal (Y0–Y8) to queue. Link a terminal under Devices first.' },
    };
  }

  const { data: pending } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload')
    .eq('farm_id', farmId)
    .eq('action', action)
    .eq('status', 'pending');

  const alreadyPending = new Set(
    (pending || []).flatMap((row) => deviceCodesFromQueueRow(row)),
  );

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();
  const base = payload && typeof payload === 'object' ? payload : {};

  const rows = codes
    .filter((code) => !alreadyPending.has(code))
    .map((code) => {
      const until = untilFor ? untilFor(code) : base.until;
      const rowPayload = { ...base, device_codes: [code] };
      if (until && (until.liters != null || until.minutes != null)) rowPayload.until = until;
      else delete rowPayload.until;

      return {
        farm_id: farmId,
        device_code: code,
        action,
        job_id: jobId,
        zone_id: zoneId,
        payload: rowPayload,
        status: 'pending',
        created_at: now.toISOString(),
        expires_at: expiresAt,
      };
    });

  if (!rows.length) {
    return { data: pending?.[0] || null, error: null };
  }

  const { data, error } = await supabase
    .from('irrigation_command_queue')
    .insert(rows)
    .select('id');

  return { data: data?.[0] || null, error };
}

export async function cancelPendingCommandsForZone(farmId, zoneId) {
  return supabase
    .from('irrigation_command_queue')
    .update({ status: 'cancelled' })
    .eq('farm_id', farmId)
    .eq('zone_id', zoneId)
    .eq('status', 'pending');
}

export async function cancelPendingCommandsForCodes(farmId, deviceCodes) {
  const codes = uniqueDeviceCodes(deviceCodes);
  if (!codes.length) return { error: null };
  const wanted = new Set(codes);
  const { data: pending, error } = await supabase
    .from('irrigation_command_queue')
    .select('id, device_code, payload')
    .eq('farm_id', farmId)
    .eq('status', 'pending');
  if (error) return { error };
  const ids = (pending || [])
    .filter((row) => deviceCodesFromQueueRow(row).some((code) => wanted.has(code)))
    .map((row) => row.id);
  if (!ids.length) return { error: null };
  return supabase
    .from('irrigation_command_queue')
    .update({ status: 'cancelled' })
    .in('id', ids);
}

/**
 * Manual Start/Stop: write queue + legacy zone pending_command.
 */
export async function sendZoneControlCommand(farmId, row, command) {
  const deviceCode = await fetchZoneValveDeviceCode(farmId, row.zone.id);
  if (!deviceCode) {
    return {
      error: `Link a zone valve terminal under Devices for ${row.zone.zone_code} first.`,
    };
  }

  await cancelPendingCommandsForZone(farmId, row.zone.id);

  const queueResult = await enqueueIrrigationCommand({
    farmId,
    deviceCodes: [deviceCode],
    action: command,
    zoneId: row.zone.id,
    payload: command === 'start' ? { until: {} } : {},
  });

  if (queueResult.error && isMissingScheduleTable(queueResult.error)) {
    // Fall back to legacy-only if 039 not applied yet
    const { error } = await supabase
      .from('irrigation_zone_status')
      .upsert(sendIrrigationCommandPayload(farmId, row, command), { onConflict: 'zone_id' });
    return { error: error || null, legacyOnly: true };
  }

  if (queueResult.error) {
    return { error: queueResult.error.message };
  }

  const { error } = await supabase
    .from('irrigation_zone_status')
    .upsert(sendIrrigationCommandPayload(farmId, row, command), { onConflict: 'zone_id' });

  if (error) {
    if (String(error.message || '').includes('pending_command')) {
      return { error: 'Run migration 038_irrigation_zone_commands.sql in Supabase, then try again.' };
    }
    return { error: error.message };
  }

  return { error: null, commandId: queueResult.data?.id };
}

export async function createAdHocVolumeJob({
  farmId,
  zoneId,
  targetLiters = null,
  onDurationMinutes = null,
  jobType = 'manual',
  windowMode = false,
  deviceIds = [],
  motorDeviceId = null,
  injectorDeviceIds = [],
  immediate = true,
}) {
  const now = new Date().toISOString();
  const duration = onDurationMinutes != null && Number(onDurationMinutes) > 0
    ? Number(onDurationMinutes)
    : null;
  const liters = targetLiters != null && Number(targetLiters) > 0
    ? Number(targetLiters)
    : null;

  if (immediate) {
    const paused = await pauseOpenIrrigationJobs(farmId, { reason: 'manual_override' });
    if (paused.error) return { error: paused.error, job: null };
  }

  // Run-time cap so a liter target that the meter never confirms cannot keep the
  // job — and therefore the whole farm queue — open forever.
  const { data: zoneRow } = await supabase
    .from('irrigation_zones')
    .select('flow_rate_lph')
    .eq('id', zoneId)
    .maybeSingle();
  const flow = zoneRow?.flow_rate_lph != null ? Number(zoneRow.flow_rate_lph) : null;
  const capMinutes = duration
    || (liters && flow && flow > 0 ? Math.max(1, Math.ceil((liters / flow) * 60 * 1.5)) : null);

  const { data: job, error } = await supabase
    .from('irrigation_jobs')
    .insert({
      farm_id: farmId,
      zone_id: zoneId,
      job_type: jobType,
      status: 'planned',
      target_liters: liters,
      on_duration_minutes: duration,
      max_duration_minutes: capMinutes,
      duration_elapsed_minutes: 0,
      liters_delivered: 0,
      current_step_seq: 0,
      window_mode: windowMode,
      scheduled_for: now,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error) return { error, job: null };

  const deviceRows = [];
  if (motorDeviceId) {
    deviceRows.push({ job_id: job.id, device_id: Number(motorDeviceId), role: 'motor' });
  }
  [...(injectorDeviceIds || []), ...(deviceIds || [])].forEach((deviceId) => {
    if (!deviceId) return;
    deviceRows.push({ job_id: job.id, device_id: Number(deviceId), role: 'injector' });
  });

  if (deviceRows.length) {
    const { error: linkError } = await supabase.from('irrigation_job_devices').insert(deviceRows);
    if (linkError) return { error: linkError, job };
  }

  if (immediate) {
    const extraIds = deviceRows.map((r) => r.device_id);
    const extraCodes = [];
    if (extraIds.length) {
      const { data: extraDevices } = await supabase
        .from('irrigation_devices')
        .select('id, device_code, kind')
        .in('id', extraIds);
      const motors = (extraDevices || []).filter((d) => String(d.kind || '').includes('motor'));
      const rest = (extraDevices || []).filter((d) => !String(d.kind || '').includes('motor'));
      [...motors, ...rest].forEach((device) => {
        if (device.device_code) extraCodes.push(device.device_code);
      });
    }

    const valveCode = await fetchZoneValveDeviceCode(farmId, zoneId);
    const startCodes = uniqueTerminalCodes([...extraCodes, valveCode]);
    if (!startCodes.length) {
      return {
        error: { message: 'Link a zone valve (and equipment) terminal under Devices first.' },
        job,
      };
    }

    // Only the metered zone valve gets a litre target; equipment stops on time.
    await enqueueIrrigationCommand({
      farmId,
      deviceCodes: startCodes,
      action: 'start',
      jobId: job.id,
      zoneId,
      untilFor: (code) => (
        code === valveCode && liters != null
          ? { liters, minutes: capMinutes ?? undefined }
          : { minutes: capMinutes ?? undefined }
      ),
    });

    const { data: existingStatus } = await supabase
      .from('irrigation_zone_status')
      .select('zone_id')
      .eq('zone_id', zoneId)
      .maybeSingle();

    if (existingStatus) {
      await supabase.from('irrigation_zone_status').update({
        pending_command: 'start',
        pending_command_at: now,
        updated_at: now,
      }).eq('zone_id', zoneId);
    } else {
      await supabase.from('irrigation_zone_status').insert({
        zone_id: zoneId,
        farm_id: farmId,
        pending_command: 'start',
        pending_command_at: now,
        updated_at: now,
        reported_at: now,
        is_irrigating: false,
      });
    }

    await supabase.from('irrigation_jobs').update({
      status: 'running',
      started_at: now,
      updated_at: now,
    }).eq('id', job.id);
    job.status = 'running';
    job.started_at = now;
  }

  return { error: null, job };
}

/** Pause other open jobs so a manual/quick job can take the pump immediately. */
export async function pauseOpenIrrigationJobs(farmId, { exceptJobId = null, reason = 'manual_override' } = {}) {
  const now = new Date().toISOString();
  let query = supabase
    .from('irrigation_jobs')
    .select('id, zone_id, status, job_type, program_id')
    .eq('farm_id', farmId)
    .in('status', OPEN_JOB_STATUSES);

  if (exceptJobId) query = query.neq('id', exceptJobId);

  const { data: openJobs, error } = await query;
  if (error) return { error, pausedIds: [] };

  const ids = (openJobs || []).map((j) => j.id);
  if (!ids.length) return { error: null, pausedIds: [] };

  // Stop any zones that were watering
  for (const job of openJobs || []) {
    if (job.status !== 'running') continue;
    const codes = await fetchJobTerminalCodes(farmId, job);
    if (codes.length) {
      await enqueueIrrigationCommand({
        farmId,
        deviceCodes: codes,
        action: 'stop',
        jobId: job.id,
        zoneId: job.zone_id,
        payload: { reason },
      });
    }
    if (job.zone_id) {
      await supabase.from('irrigation_zone_status').update({
        pending_command: 'stop',
        pending_command_at: now,
        updated_at: now,
      }).eq('zone_id', job.zone_id);
    }
  }

  const { error: updateError } = await supabase
    .from('irrigation_jobs')
    .update({
      status: 'planned',
      liters_baseline: null,
      updated_at: now,
    })
    .in('id', ids);

  return { error: updateError || null, pausedIds: ids };
}

export async function updateIrrigationJob(jobId, { zoneId, targetLiters, onDurationMinutes }) {
  const patch = { updated_at: new Date().toISOString() };
  if (zoneId != null) patch.zone_id = zoneId;
  if (targetLiters != null) patch.target_liters = targetLiters;
  if (onDurationMinutes != null) patch.on_duration_minutes = onDurationMinutes;

  const { data, error } = await supabase
    .from('irrigation_jobs')
    .update(patch)
    .eq('id', jobId)
    .select('*')
    .single();

  return { data, error };
}

export async function deleteIrrigationJob(farmId, job) {
  const now = new Date().toISOString();

  if (job.zone_id && OPEN_JOB_STATUSES.includes(job.status)) {
    const codes = await fetchJobTerminalCodes(farmId, job);
    if (codes.length) {
      await enqueueIrrigationCommand({
        farmId,
        deviceCodes: codes,
        action: 'stop',
        jobId: job.id,
        zoneId: job.zone_id,
        payload: { reason: 'job_cancelled' },
      });
    }
    await supabase.from('irrigation_zone_status').update({
      pending_command: 'stop',
      pending_command_at: now,
      updated_at: now,
    }).eq('zone_id', job.zone_id);
  }

  const { error } = await supabase
    .from('irrigation_jobs')
    .update({
      status: 'cancelled',
      completed_at: now,
      updated_at: now,
    })
    .eq('id', job.id);

  return { error };
}


export function formatClockDisplay(time) {
  const text = formatTimeInput(time);
  if (!text) return '';
  const [h, m] = text.split(':').map(Number);
  const hour = Number.isFinite(h) ? h : 0;
  const min = Number.isFinite(m) ? m : 0;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${ampm}`;
}

export function jobStatusLabel(status) {
  if (status === 'running') return 'Running now';
  if (status === 'planned') return 'Waiting its turn';
  if (status === 'paused_outside_window') return 'Waiting';
  if (status === 'paused_no_power') return 'Paused — no mains power';
  if (status === 'completed') return 'Done';
  if (status === 'cancelled') return 'Cancelled';
  return status || '—';
}

export function jobProgressLabel(job) {
  if (!job) return '—';
  const duration = Number(job.on_duration_minutes);
  if (duration > 0 && !(Number(job.target_liters) > 0)) {
    const elapsed = Math.round(Number(job.duration_elapsed_minutes) || 0);
    return `${elapsed} / ${duration} min`;
  }
  const delivered = Number(job.liters_delivered) || 0;
  const target = Number(job.target_liters);
  if (!target) return `${delivered} L`;
  return `${delivered} / ${target} L`;
}

export function programDaysLabel(daysOfWeek) {
  const days = Array.isArray(daysOfWeek) ? daysOfWeek : [];
  if (!days.length) return 'No days';
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAY_LABELS[d] || d)
    .join(', ');
}

export function programTimesLabel(startTimes) {
  const times = Array.isArray(startTimes) ? startTimes : [];
  if (!times.length) return 'No start time';
  return times.map((t) => formatClockDisplay(t) || formatTimeInput(t)).join(', ');
}

/** Format minutes as "2h 15m" / "45m" */
export function formatEstimatedDuration(minutes) {
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins <= 0) return null;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
  if (hours > 0) return `${hours}h`;
  return `${rem}m`;
}

export function estimateStepMinutes(step, zones) {
  const zone = (zones || []).find((z) => String(z.id) === String(step.zone_id));
  const fromLiters = estimateMinutesFromLiters(step.target_liters, zone?.flow_rate_lph);
  if (fromLiters != null) return fromLiters;
  const manual = Number(step.on_duration_minutes);
  return Number.isFinite(manual) && manual > 0 ? manual : null;
}

export function estimateProgramMinutes(steps, zones) {
  return (steps || []).reduce((sum, step) => {
    const mins = estimateStepMinutes(step, zones);
    return sum + (mins || 0);
  }, 0);
}

