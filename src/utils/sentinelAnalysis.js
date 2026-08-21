/**
 * GEE-equivalent Sentinel-2 L2A analysis settings (values only, no map).
 * Mirrors typical Earth Engine scripts:
 *   filterBounds → filterDate → filter(cloud) → SCL mask → normalizedDifference → reduceRegion(mean)
 */

/** Sentinel-2 10 m band mapping (COPERNICUS/S2_SR harmonized) */
export const S2_BANDS = {
  red: 'B4',
  nir: 'B8',
  redEdge: 'B8A',
  swir: 'B11',
  scl: 'SCL',
};

/** Default analysis parameters matching common GEE orchard scripts */
export const SENTINEL_ANALYSIS = {
  collection: 'sentinel-2-l2a',
  /** Scene-level filter; pixels are masked separately via SCL (June monsoon often 20–60%) */
  maxCloudCover: 50,
  scaleMeters: 10,
  lookbackDays: 365,
  plotSceneLimit: 24,
  maxPlotSamplePoints: 40,
  /** SCL classes excluded from analysis (cloud, shadow, snow, etc.) */
  excludedScl: new Set([0, 1, 2, 3, 8, 9, 10, 11]),
  /** Pixels allowed into index calculation */
  validScl: new Set([4, 5, 6, 7]),
  plotReducer: 'mean',
  treeReducer: 'mean',
  treeNeighborhoodMeters: 10,
  maxNearestPlotMeters: 35,
};

export function meanValue(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

export function aggregateValues(values, reducer = 'mean') {
  if (!values.length) return null;
  if (reducer === 'median') {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
  return meanValue(values);
}

export function isValidScl(scl) {
  if (scl == null) return true;
  return SENTINEL_ANALYSIS.validScl.has(Number(scl));
}

export function modeValue(values) {
  if (!values.length) return null;
  const counts = new Map();
  values.forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  let best = values[0];
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  });
  return best;
}
