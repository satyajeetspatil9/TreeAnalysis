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

export function isMissingScheduleTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /irrigation_(devices|allowed_windows|programs|jobs|command_queue|device_schedules)/.test(message);
}

export function scheduleTableHint(message) {
  if (!message) return message;
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
  jobType = 'water',
  windowMode = true,
  deviceIds = [],
}) {
  const now = new Date().toISOString();
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

  return { error: null, job };
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
