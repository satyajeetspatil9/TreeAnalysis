import { formatNumber } from './formatters';

/** Water (L) = zone flow (L/hr) × duration (hours) */
export function calcIrrigationWaterLiters(flowRateLph, durationMinutes) {
  const flow = Number(flowRateLph);
  const minutes = Number(durationMinutes);
  if (!flow || !minutes) return null;
  return (flow * minutes) / 60;
}

export function formatWaterLiters(liters) {
  if (liters == null || Number.isNaN(Number(liters))) return '—';
  return `${formatNumber(liters, 0)} L`;
}

/** Prefer stored liters; otherwise flow (L/hr) × duration. */
export function resolveEventWaterLiters(event) {
  if (!event) return null;
  const stored = Number(event.water_liters);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const flow = Number(
    event.flow_rate_lph
    ?? event.irrigation_zones?.flow_rate_lph,
  );
  return calcIrrigationWaterLiters(flow, event.duration_minutes);
}

/** Equal share per active tree in the zone (matches expense allocation). */
export function calcTreeWaterShare(zoneWaterLiters, treeCount) {
  const water = Number(zoneWaterLiters);
  const count = Number(treeCount);
  if (!Number.isFinite(water) || water <= 0) return null;
  const trees = Number.isFinite(count) && count > 0 ? count : 1;
  return water / trees;
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
      zoneWater: resolveEventWaterLiters(e),
      treeWater: calcTreeWaterShare(resolveEventWaterLiters(e), treeCount),
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
    bucket.zoneWater += resolveEventWaterLiters(e) || 0;
    bucket.treeWater += calcTreeWaterShare(resolveEventWaterLiters(e), treeCount) || 0;
    bucket.duration += Number(e.duration_minutes) || 0;
    bucket.eventCount += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Farm monitoring chart: total water and duration by period. */
export function buildFarmIrrigationChartData(events, grouping = 'week') {
  const rows = buildIrrigationChartData(events, 1, grouping);
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    water: row.zoneWater || 0,
    duration: row.duration || 0,
    eventCount: row.eventCount || 0,
  }));
}

/** Farm fertigation chart: water and summed product quantity by period. */
export function buildFarmFertigationChartData(events, grouping = 'week') {
  const sorted = [...(events || [])].sort(
    (a, b) => new Date(a.event_date) - new Date(b.event_date),
  );

  const toPoint = (e) => {
    const water = resolveEventWaterLiters(e) || Number(e.water_liters) || 0;
    const productQty = e.productsInherited
      ? 0
      : (e.fertigation_products || []).reduce(
        (sum, row) => sum + (Number(row.quantity) || 0),
        0,
      );
    return {
      water,
      productQty,
      duration: Number(e.duration_minutes) || 0,
    };
  };

  if (grouping === 'event') {
    return sorted.map((e) => {
      const point = toPoint(e);
      const zone = e.irrigation_zones?.zone_code;
      return {
        key: e.id,
        label: `${new Date(e.event_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}${zone ? ` ${zone}` : ''}`,
        water: point.water,
        productQty: point.productQty,
        duration: point.duration,
        eventCount: 1,
      };
    });
  }

  const buckets = new Map();
  sorted.forEach((e) => {
    const key = periodKey(e.event_date, grouping);
    const bucket = buckets.get(key) || {
      key,
      label: periodLabel(key, grouping),
      water: 0,
      productQty: 0,
      duration: 0,
      eventCount: 0,
    };
    const point = toPoint(e);
    bucket.water += point.water;
    bucket.productQty += point.productQty;
    bucket.duration += point.duration;
    bucket.eventCount += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
