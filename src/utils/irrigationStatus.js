import { formatDate, formatNumber } from './formatters';

export const IRRIGATION_STATUS_POLL_MS = 3 * 60 * 1000;

export function buildIrrigationStatusSampleJson(zoneCode = 'Z01') {
  const now = new Date().toISOString();
  return JSON.stringify({
    zone_code: zoneCode,
    is_irrigating: true,
    started_at: now,
    reported_at: now,
    voltage_v: 230,
    current_amp: 4.2,
    start_indicator: true,
    stop_indicator: false,
    current_discharge_lpm: 12.5,
    total_discharge_liters: 450,
    device_code: 'ESP32-IRR-01',
  }, null, 2);
}

export function formatIrrigationDuration(startedAt, nowMs = Date.now()) {
  if (!startedAt) return '—';
  const ms = nowMs - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function formatDischargeRate(value) {
  if (value == null) return '—';
  return `${formatNumber(value, 2)} L/min`;
}

export function formatTotalDischarge(value) {
  if (value == null) return '—';
  return `${formatNumber(value, 1)} L`;
}

export function formatVoltage(value) {
  if (value == null) return '—';
  return `${formatNumber(value, 1)} V`;
}

export function formatAmperage(value) {
  if (value == null) return '—';
  return `${formatNumber(value, 2)} A`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function mergeZoneStatusRows(zones, statusRows) {
  const statusByZoneId = new Map((statusRows || []).map((row) => [row.zone_id, row]));

  return (zones || []).map((zone) => {
    const status = statusByZoneId.get(zone.id) || null;
    return {
      zone,
      status,
      isIrrigating: Boolean(status?.is_irrigating),
      hasTelemetry: Boolean(status?.reported_at),
    };
  }).sort((a, b) => {
    if (a.isIrrigating !== b.isIrrigating) return a.isIrrigating ? -1 : 1;
    return String(a.zone.zone_code).localeCompare(String(b.zone.zone_code), undefined, { numeric: true });
  });
}

export function countIrrigationStatusRows(rows) {
  const counts = {
    irrigating: 0,
    idle: 0,
    noData: 0,
  };

  rows.forEach((row) => {
    if (!row.hasTelemetry) {
      counts.noData += 1;
      return;
    }
    if (row.isIrrigating) counts.irrigating += 1;
    else counts.idle += 1;
  });

  return counts;
}

export function isMissingStatusTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('irrigation_zone_status');
}

export function statusTableHint(message) {
  if (!message?.includes('irrigation_zone_status')) return message;
  return `${message} Run migration 037_irrigation_zone_status.sql in Supabase SQL Editor.`;
}

export function formatLastUpdated(value) {
  if (!value) return 'Never';
  return formatDate(value);
}

export function formatRelativeTime(value, nowMs = Date.now()) {
  if (!value) return 'Never';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return formatLastUpdated(value);
  const diffSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatLastUpdated(value);
}

export function sendIrrigationCommandPayload(farmId, row, command) {
  const now = new Date().toISOString();
  const isStart = command === 'start';
  const existing = row.status || {};

  return {
    zone_id: row.zone.id,
    farm_id: farmId,
    is_irrigating: isStart,
    started_at: isStart ? (existing.started_at || now) : null,
    voltage_v: existing.voltage_v ?? null,
    current_amp: existing.current_amp ?? null,
    start_indicator: isStart,
    stop_indicator: !isStart,
    current_discharge_lpm: isStart ? existing.current_discharge_lpm ?? null : existing.current_discharge_lpm ?? null,
    total_discharge_liters: isStart ? existing.total_discharge_liters ?? 0 : existing.total_discharge_liters ?? null,
    device_code: existing.device_code ?? null,
    reported_at: existing.reported_at || now,
    updated_at: now,
    pending_command: command,
    pending_command_at: now,
  };
}

export function formatIrrigationDurationLong(startedAt, nowMs = Date.now()) {
  if (!startedAt) return '—';
  const ms = nowMs - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
