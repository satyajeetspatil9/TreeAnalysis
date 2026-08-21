import { formatNumber } from './formatters';

/** Water (L) = zone flow (L/hr) × duration (hours) */
export function calcIrrigationWaterLiters(flowRateLph, durationMinutes) {
  const flow = Number(flowRateLph);
  const minutes = Number(durationMinutes);
  if (!flow || !minutes) return null;
  return (flow * minutes) / 60;
}

export function formatWaterLiters(liters) {
  if (liters == null || Number.isNaN(liters)) return '—';
  return `${formatNumber(liters, 0)} L`;
}

/** Equal share per active tree in the zone (matches expense allocation). */
export function calcTreeWaterShare(zoneWaterLiters, treeCount) {
  const water = Number(zoneWaterLiters);
  const count = Number(treeCount);
  if (!water || !count) return null;
  return water / count;
}

export const IRRIGATION_PERIOD_OPTIONS = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: '180d', label: 'Last 6 months', days: 180 },
  { value: '365d', label: 'Last year', days: 365 },
  { value: 'all', label: 'All time', days: null },
];

export const IRRIGATION_GROUP_OPTIONS = [
  { value: 'event', label: 'Per event' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

export const IRRIGATION_METRIC_OPTIONS = [
  { value: 'zoneWater', label: 'Zone water (L)', unit: 'L' },
  { value: 'treeWater', label: 'This tree (L)', unit: 'L' },
  { value: 'duration', label: 'Duration (min)', unit: 'min' },
];

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function periodKey(date, grouping) {
  const d = new Date(date);
  if (grouping === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (grouping === 'week') {
    return startOfWeek(d).toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function periodLabel(key, grouping) {
  const d = new Date(key);
  if (grouping === 'month') {
    return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }
  if (grouping === 'week') {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function filterEventsByPeriod(events, periodKey) {
  const option = IRRIGATION_PERIOD_OPTIONS.find((o) => o.value === periodKey);
  if (!option?.days) return events;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - option.days);
  return events.filter((e) => new Date(e.event_date) >= cutoff);
}

export function buildIrrigationChartData(events, treeCount, grouping = 'event') {
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_date) - new Date(b.event_date),
  );

  if (grouping === 'event') {
    return sorted.map((e) => ({
      key: e.id,
      label: new Date(e.event_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      zoneWater: e.water_liters != null ? Number(e.water_liters) : null,
      treeWater: calcTreeWaterShare(e.water_liters, treeCount),
      duration: e.duration_minutes != null ? Number(e.duration_minutes) : null,
      eventCount: 1,
    }));
  }

  const buckets = new Map();
  sorted.forEach((e) => {
    const key = periodKey(e.event_date, grouping);
    const bucket = buckets.get(key) || {
      key,
      label: periodLabel(key, grouping),
      zoneWater: 0,
      treeWater: 0,
      duration: 0,
      eventCount: 0,
    };
    bucket.zoneWater += Number(e.water_liters) || 0;
    bucket.treeWater += calcTreeWaterShare(e.water_liters, treeCount) || 0;
    bucket.duration += Number(e.duration_minutes) || 0;
    bucket.eventCount += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
