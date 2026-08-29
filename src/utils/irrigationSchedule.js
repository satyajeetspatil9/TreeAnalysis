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

export function isMissingScheduleTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /irrigation_(devices|allowed_windows|programs|jobs|command_queue|device_schedules)/.test(message);
}

export function scheduleTableHint(message) {
  if (!message) return message;
  if (/duration_elapsed_minutes/.test(message) || /column .*on_duration_minutes.*irrigation_jobs/.test(message)) {
    return `${message} Run migration 043_irrigation_job_duration.sql in Supabase SQL Editor.`;
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

export function buildCommandQueueSampleJson() {
  return JSON.stringify({
    ok: true,
    updated_at: new Date().toISOString(),
    commands: [
      {
        id: 1,
        device_code: 'ZONE-Z01',
        action: 'start',
        job_id: 12,
        zone_code: 'Z01',
        until: { liters: 6000 },
      },
      {
        id: 2,
        device_code: 'MOTOR-1',
        action: 'start',
        job_id: 12,
      },
    ],
    pending_commands: [
      { zone_code: 'Z01', command: 'start', command_at: new Date().toISOString() },
    ],
  }, null, 2);
}

/**
 * Enqueue a farm command and keep legacy pending_command on zone status for manual zone control.
 */
export async function enqueueIrrigationCommand({
  farmId,
  deviceCode,
  action,
  jobId = null,
  zoneId = null,
  payload = {},
  expiresInMinutes = 30,
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('irrigation_command_queue')
    .insert({
      farm_id: farmId,
      device_code: String(deviceCode).trim().toUpperCase(),
      action,
      job_id: jobId,
      zone_id: zoneId,
      payload,
      status: 'pending',
      created_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  return { data, error };
}

export async function cancelPendingCommandsForZone(farmId, zoneId) {
  return supabase
    .from('irrigation_command_queue')
    .update({ status: 'cancelled' })
    .eq('farm_id', farmId)
    .eq('zone_id', zoneId)
    .eq('status', 'pending');
}

/**
 * Manual Start/Stop: write queue + legacy zone pending_command.
 */
export async function sendZoneControlCommand(farmId, row, command) {
  const zoneCode = row.zone.zone_code;
  const deviceCode = row.status?.device_code
    || `ZONE-${String(zoneCode).toUpperCase()}`;

  await cancelPendingCommandsForZone(farmId, row.zone.id);

  const queueResult = await enqueueIrrigationCommand({
    farmId,
    deviceCode,
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
  targetLiters,
  jobType = 'manual',
  windowMode = true,
  deviceIds = [],
  immediate = true,
}) {
  const now = new Date().toISOString();

  if (immediate) {
    const paused = await pauseOpenIrrigationJobs(farmId, { reason: 'manual_override' });
    if (paused.error) return { error: paused.error, job: null };
  }

  const { data: job, error } = await supabase
    .from('irrigation_jobs')
    .insert({
      farm_id: farmId,
      zone_id: zoneId,
      job_type: jobType,
      status: 'planned',
      target_liters: targetLiters,
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

  if (deviceIds.length) {
    const rows = deviceIds.map((deviceId) => ({
      job_id: job.id,
      device_id: deviceId,
      role: 'injector',
    }));
    const { error: linkError } = await supabase.from('irrigation_job_devices').insert(rows);
    if (linkError) return { error: linkError, job };
  }

  if (immediate) {
    const { data: zone } = await supabase
      .from('irrigation_zones')
      .select('id, zone_code')
      .eq('id', zoneId)
      .maybeSingle();
    const deviceCode = zone?.zone_code
      ? `ZONE-${String(zone.zone_code).toUpperCase()}`
      : `ZONE-${zoneId}`;

    await enqueueIrrigationCommand({
      farmId,
      deviceCode,
      action: 'start',
      jobId: job.id,
      zoneId,
      payload: { until: { liters: Number(targetLiters) } },
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
    .select('id, zone_id, status, job_type')
    .eq('farm_id', farmId)
    .in('status', ['planned', 'running', 'paused_outside_window']);

  if (exceptJobId) query = query.neq('id', exceptJobId);

  const { data: openJobs, error } = await query;
  if (error) return { error, pausedIds: [] };

  const ids = (openJobs || []).map((j) => j.id);
  if (!ids.length) return { error: null, pausedIds: [] };

  // Stop any zones that were watering
  for (const job of openJobs || []) {
    if (job.status !== 'running' || !job.zone_id) continue;
    const { data: zone } = await supabase
      .from('irrigation_zones')
      .select('zone_code')
      .eq('id', job.zone_id)
      .maybeSingle();
    const deviceCode = zone?.zone_code
      ? `ZONE-${String(zone.zone_code).toUpperCase()}`
      : null;
    if (deviceCode) {
      await enqueueIrrigationCommand({
        farmId,
        deviceCode,
        action: 'stop',
        jobId: job.id,
        zoneId: job.zone_id,
        payload: { reason },
      });
    }
    await supabase.from('irrigation_zone_status').update({
      pending_command: 'stop',
      pending_command_at: now,
      updated_at: now,
    }).eq('zone_id', job.zone_id);
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

export async function updateIrrigationJob(jobId, { zoneId, targetLiters }) {
  const patch = { updated_at: new Date().toISOString() };
  if (zoneId != null) patch.zone_id = zoneId;
  if (targetLiters != null) patch.target_liters = targetLiters;

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

  if (job.zone_id && (job.status === 'running' || job.status === 'planned')) {
    const { data: zone } = await supabase
      .from('irrigation_zones')
      .select('zone_code')
      .eq('id', job.zone_id)
      .maybeSingle();
    const deviceCode = zone?.zone_code
      ? `ZONE-${String(zone.zone_code).toUpperCase()}`
      : null;
    if (deviceCode) {
      await enqueueIrrigationCommand({
        farmId,
        deviceCode,
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


export function jobProgressLabel(job) {
  if (!job) return '—';
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
  if (!times.length) return 'Allowed windows';
  return times.map(formatTimeInput).join(', ');
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

/**
 * Suggest program start times from MSEB allowed windows for selected weekdays.
 * Returns sorted unique HH:MM starts (and optionally ends for display).
 */
export function suggestStartsFromAllowedWindows(windows, daysOfWeek = []) {
  const days = (daysOfWeek || []).map(Number);
  const starts = new Set();
  const slots = [];

  (windows || [])
    .filter((w) => w.enabled !== false)
    .filter((w) => !days.length || days.includes(Number(w.weekday)))
    .forEach((w) => {
      const start = timeToInputValue(w.start_time);
      const end = timeToInputValue(w.end_time);
      if (!start) return;
      starts.add(start);
      slots.push({
        weekday: Number(w.weekday),
        start,
        end,
        label: `${WEEKDAY_LABELS[Number(w.weekday)] || '?'} ${start}–${end}`,
      });
    });

  return {
    starts: [...starts].sort(),
    slots: slots.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
  };
}

/** Earliest suggested start for new programs; falls back to 06:00 */
export function defaultStartFromWindows(windows, daysOfWeek = []) {
  const { starts } = suggestStartsFromAllowedWindows(windows, daysOfWeek);
  return starts[0] || '06:00';
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

