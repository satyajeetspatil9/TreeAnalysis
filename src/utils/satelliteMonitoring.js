import {
  friendlyIndexStatus,
  friendlyOverallStatus,
  friendlyStressStatus,
  overallStressLevel,
} from './satelliteDisplay';

export const SATELLITE_MONITOR_COLUMNS = [
  { key: 'overall', label: 'Overall', short: 'Combined signal' },
  { key: 'ndvi', label: 'Greenness', short: 'Canopy health' },
  { key: 'ndmi', label: 'Moisture', short: 'Soil & leaf water' },
  { key: 'ndre', label: 'Nitrogen', short: 'Leaf nutrients' },
  { key: 'water', label: 'Water stress', short: 'Irrigation signal' },
  { key: 'nutrient', label: 'Nutrient stress', short: 'Fertilizer signal' },
  { key: 'radar', label: 'Radar', short: 'Wetness signal' },
];

export const SATELLITE_STRESS_FILTER_OPTIONS = [
  { value: 'all', label: 'All stress levels' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High stress' },
  { value: 'moderate', label: 'Needs attention' },
  { value: 'low', label: 'Looking good' },
  { value: 'no_cache', label: 'No satellite data' },
  { value: 'no_gps', label: 'Missing GPS' },
];

export function extractSatelliteIndicators(analysis) {
  if (!analysis) return null;

  const overall = analysis.overall_condition || {};
  const indexStatus = analysis.index_status || {};
  const water = analysis.water_stress || {};
  const nutrient = analysis.nutrient_stress || {};
  const radar = analysis.radar_stress || {};
  const overallFriendly = friendlyOverallStatus(overall.status, overall.severity);

  return {
    overall: {
      label: overallFriendly.headline,
      summary: overallFriendly.summary,
      raw: overall.severity || overall.status,
      stressPct: overall.stress_percentage,
    },
    ndvi: friendlyIndexStatus(indexStatus.NDVI),
    ndmi: friendlyIndexStatus(indexStatus.NDMI),
    ndre: friendlyIndexStatus(indexStatus.NDRE),
    water: friendlyStressStatus(water.status),
    nutrient: friendlyStressStatus(nutrient.status || nutrient.indicator),
    radar: friendlyStressStatus(radar.status),
  };
}

export function getSatelliteRowMeta({ hasGps, cache, indicators }) {
  if (!hasGps) {
    return { category: 'no_gps', sortRank: 5 };
  }
  if (!cache?.analysis || !indicators) {
    return { category: cache?.error_message ? 'no_cache' : 'no_cache', sortRank: 4 };
  }

  const category = overallStressLevel(indicators.overall.raw, indicators.overall.stressPct);
  const sortRank = {
    critical: 0,
    high: 1,
    moderate: 2,
    low: 3,
    unknown: 4,
  }[category] ?? 4;

  return { category, sortRank };
}

export function matchesSatelliteStressFilter(category, filterValue) {
  if (!filterValue || filterValue === 'all') return true;
  if (filterValue === 'no_gps') return category === 'no_gps';
  if (filterValue === 'no_cache') return category === 'no_cache';
  return category === filterValue;
}

export function countSatelliteStressRows(rows) {
  const counts = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    no_cache: 0,
    no_gps: 0,
  };

  rows.forEach((row) => {
    counts[row.meta.category] = (counts[row.meta.category] || 0) + 1;
  });

  return counts;
}
