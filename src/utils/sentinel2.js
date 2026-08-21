import { computeStressFromNdvi as stressFromNdvi } from './spectralIndices';
import { samplePointsInPolygonAtSpacing, distanceApproxMeters } from './geo';
import {
  SENTINEL_ANALYSIS,
  aggregateValues,
  isValidScl,
  modeValue,
} from './sentinelAnalysis';

const EARTH_SEARCH_STAC = 'https://earth-search.aws.element84.com/v1/search';
const SENTINEL_COLLECTION = SENTINEL_ANALYSIS.collection;
const TITILER_POINT = 'https://titiler.xyz/cog/point';
const TITILER_MIN_INTERVAL_MS = 120;
const TITILER_MAX_RETRIES = 4;

let lastTitilerRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function throttleTitiler() {
  const now = Date.now();
  const waitMs = TITILER_MIN_INTERVAL_MS - (now - lastTitilerRequestAt);
  if (waitMs > 0) await sleep(waitMs);
  lastTitilerRequestAt = Date.now();
}

async function fetchTitilerPoint(longitude, latitude, meta) {
  if (!meta?.href) return null;

  const pointUrl = `${TITILER_POINT}/${longitude},${latitude}?url=${encodeURIComponent(meta.href)}`;

  for (let attempt = 0; attempt < TITILER_MAX_RETRIES; attempt += 1) {
    await throttleTitiler();
    try {
      const response = await fetch(pointUrl);
      if (response.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

const BAND_ASSETS = {
  red: 'red',
  nir: 'nir',
  rededge: 'rededge1',
  swir: 'swir16',
  scl: 'scl',
};

/** ~5 m offsets for tree GPS refinement */
const TREE_SAMPLE_OFFSETS = [
  [0, 0],
  [0.00005, 0],
  [-0.00005, 0],
  [0, 0.00005],
  [0, -0.00005],
];

export function computeNdvi(nir, red) {
  if (nir == null || red == null) return null;
  const sum = nir + red;
  if (sum === 0) return null;
  return (nir - red) / sum;
}

export function computeNdre(nir, redEdge) {
  if (nir == null || redEdge == null) return null;
  const sum = nir + redEdge;
  if (sum === 0) return null;
  return (nir - redEdge) / sum;
}

export function computeNdmi(nir, swir) {
  if (nir == null || swir == null) return null;
  const sum = nir + swir;
  if (sum === 0) return null;
  return (nir - swir) / sum;
}

export function computeStressFromNdvi(ndvi) {
  return stressFromNdvi(ndvi);
}

function getAssetMeta(item, assetKey) {
  const asset = item?.assets?.[assetKey];
  if (!asset?.href) return null;

  const bandMeta = asset['raster:bands']?.[0] || {};
  return {
    href: asset.href,
    scale: bandMeta.scale ?? 1,
    offset: bandMeta.offset ?? 0,
    nodata: bandMeta.nodata ?? 0,
  };
}

function stacDateRange(lookbackDays) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - lookbackDays);
  return `${start.toISOString().slice(0, 10)}T00:00:00Z/${end.toISOString().slice(0, 10)}T23:59:59Z`;
}

function toReflectance(raw, meta) {
  if (raw == null || raw === meta.nodata) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const scale = meta.scale ?? 1;
  const offset = meta.offset ?? 0;
  if (scale !== 1 || offset !== 0) return value * scale + offset;
  return value;
}

async function readBandValues(meta, longitude, latitude, applyScale = true, offsets = TREE_SAMPLE_OFFSETS) {
  if (!meta?.href) return [];

  const values = [];
  for (const [dLon, dLat] of offsets) {
    const payload = await fetchTitilerPoint(longitude + dLon, latitude + dLat, meta);
    if (!payload) continue;
    const raw = payload?.values?.[0];
    if (raw == null || raw === meta.nodata) continue;
    values.push(applyScale ? toReflectance(raw, meta) : Number(raw));
  }

  return values.filter((value) => value != null && Number.isFinite(value));
}

function medianValue(values) {
  return aggregateValues(values, 'median');
}

async function readBandValue(meta, longitude, latitude, applyScale = true, offsets = TREE_SAMPLE_OFFSETS) {
  return medianValue(await readBandValues(meta, longitude, latitude, applyScale, offsets));
}

function mode(values) {
  return modeValue(values);
}

async function readSclClass(item, longitude, latitude, offsets = TREE_SAMPLE_OFFSETS) {
  const meta = getAssetMeta(item, BAND_ASSETS.scl);
  const values = await readBandValues(meta, longitude, latitude, false, offsets);
  const value = mode(values);
  return value == null ? null : Number(value);
}

function dedupeSamplesByDate(samples) {
  const byDate = new Map();
  samples.forEach((sample) => {
    if (!sample.sceneDate) return;
    const existing = byDate.get(sample.sceneDate);
    if (!existing) {
      byDate.set(sample.sceneDate, sample);
      return;
    }
    const sampleCloud = sample.cloudCover ?? 100;
    const existingCloud = existing.cloudCover ?? 100;
    if (sampleCloud < existingCloud) {
      byDate.set(sample.sceneDate, sample);
      return;
    }
    if (sampleCloud === existingCloud && sample.scl === 5 && existing.scl !== 5) {
      byDate.set(sample.sceneDate, sample);
    }
  });

  return [...byDate.values()].sort(
    (a, b) => String(b.sceneDate).localeCompare(String(a.sceneDate)),
  );
}

function formatLatestSample(sample) {
  return {
    sceneDate: sample.sceneDate,
    sceneId: sample.sceneId,
    cloudCover: sample.cloudCover,
    platform: sample.platform,
    ndvi: sample.ndvi,
    ndre: sample.ndre,
    ndmi: sample.ndmi,
    stress: sample.stress,
    scl: sample.scl,
    pixelCount: sample.pixelCount ?? null,
    sampleSource: sample.sampleSource ?? null,
  };
}

function formatHistorySample(sample) {
  return {
    dateKey: sample.sceneDate,
    label: sample.sceneDate
      ? new Date(sample.sceneDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
      : '—',
    ndvi: sample.ndvi,
    ndre: sample.ndre,
    ndmi: sample.ndmi,
    stress: sample.stress,
    cloudCover: sample.cloudCover,
    sceneId: sample.sceneId,
    scl: sample.scl,
    pixelCount: sample.pixelCount ?? null,
    sampleSource: sample.sampleSource ?? null,
  };
}

function buildSentinelResult(samples, emptyError) {
  if (!samples.length) {
    return { latest: null, history: [], error: emptyError };
  }

  const datedSamples = dedupeSamplesByDate(samples);
  const latest = datedSamples[0];

  return {
    latest: formatLatestSample(latest),
    history: datedSamples.slice().reverse().map(formatHistorySample),
    error: null,
  };
}

/** When tree GPS has no clear pixels, use plot zonal mean for the same dates */
export function buildTreeResultWithPlotFallback(samples, plotSamples) {
  if (samples?.length) {
    return buildSentinelResult(samples, null);
  }
  if (!plotSamples?.length) {
    return buildSentinelResult([], 'No clear pixels at this tree location.');
  }

  const datedSamples = dedupeSamplesByDate(plotSamples);
  return {
    latest: formatLatestSample({ ...datedSamples[0], sampleSource: 'plot-mean' }),
    history: datedSamples.slice().reverse().map((sample) => formatHistorySample({
      ...sample,
      sampleSource: 'plot-mean',
    })),
    error: null,
  };
}

function aggregatePixelSamples(samples, reducer = SENTINEL_ANALYSIS.plotReducer) {
  const ndviValues = samples.map((sample) => sample.ndvi).filter((value) => value != null);
  const ndreValues = samples.map((sample) => sample.ndre).filter((value) => value != null);
  const ndmiValues = samples.map((sample) => sample.ndmi).filter((value) => value != null);
  const sclValues = samples.map((sample) => sample.scl).filter((value) => value != null);
  const ndvi = aggregateValues(ndviValues, reducer);

  return {
    ndvi,
    ndre: aggregateValues(ndreValues, reducer),
    ndmi: aggregateValues(ndmiValues, reducer),
    scl: modeValue(sclValues),
    stress: computeStressFromNdvi(ndvi),
    pixelCount: samples.length,
  };
}

async function sampleGridInBatches(item, points, sampleFn, batchSize = 4) {
  const samples = [];
  for (let index = 0; index < points.length; index += batchSize) {
    const batch = points.slice(index, index + batchSize);
    for (const point of batch) {
      const result = await sampleFn(item, point.latitude, point.longitude, point);
      if (!result.skipped) samples.push(result);
    }
    if (index + batchSize < points.length) {
      await sleep(250);
    }
  }
  return samples;
}

function buildTreeNeighborhood(latitude, longitude) {
  const spacing = SENTINEL_ANALYSIS.treeNeighborhoodMeters;
  const meterToLat = 1 / 111320;
  const meterToLng = 1 / (111320 * Math.cos((latitude * Math.PI) / 180));
  const dLat = spacing * meterToLat;
  const dLng = spacing * meterToLng;
  const points = [{ latitude, longitude }];
  for (let row = -1; row <= 1; row += 1) {
    for (let col = -1; col <= 1; col += 1) {
      if (row === 0 && col === 0) continue;
      points.push({
        latitude: latitude + (row * dLat),
        longitude: longitude + (col * dLng),
      });
    }
  }
  return points;
}

function findNearestPlotSample(plotPointSamples, latitude, longitude) {
  if (!plotPointSamples?.length) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  plotPointSamples.forEach((sample) => {
    if (sample.latitude == null || sample.longitude == null) return;
    const distance = distanceApproxMeters(latitude, longitude, sample.latitude, sample.longitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = sample;
    }
  });
  if (nearestDistance > SENTINEL_ANALYSIS.maxNearestPlotMeters) return null;
  return nearest;
}

function buildSceneSampleFromPixels(pixelSamples, item, sampleSource) {
  const aggregated = aggregatePixelSamples(pixelSamples, SENTINEL_ANALYSIS.treeReducer);
  return {
    skipped: false,
    sceneId: item.id,
    sceneDate: item.properties?.datetime?.slice(0, 10) || null,
    cloudCover: item.properties?.['eo:cloud_cover'] ?? null,
    platform: item.properties?.platform || 'Sentinel-2',
    latitude: pixelSamples[0]?.latitude ?? null,
    longitude: pixelSamples[0]?.longitude ?? null,
    sampleSource,
    ...aggregated,
  };
}

async function sampleSentinel2Tree(item, latitude, longitude, plotPointSamples, plotSample) {
  const neighborhood = buildTreeNeighborhood(latitude, longitude);
  const pixelSamples = [];

  for (const point of neighborhood) {
    const sample = await sampleSentinel2Scene(item, point.latitude, point.longitude, {
      sampleMode: 'pixel',
    });
    if (!sample.skipped) {
      pixelSamples.push({
        ...sample,
        latitude: point.latitude,
        longitude: point.longitude,
      });
    }
  }

  if (pixelSamples.length) {
    return buildSceneSampleFromPixels(
      pixelSamples,
      item,
      pixelSamples.length > 1 ? 'tree-neighborhood' : 'tree-gps',
    );
  }

  const nearest = findNearestPlotSample(plotPointSamples, latitude, longitude);
  if (nearest) {
    return {
      ...nearest,
      sampleSource: 'nearest-plot',
    };
  }

  if (plotSample && !plotSample.skipped) {
    return {
      skipped: false,
      sceneId: item.id,
      sceneDate: plotSample.sceneDate,
      cloudCover: plotSample.cloudCover,
      platform: plotSample.platform,
      ndvi: plotSample.ndvi,
      ndre: plotSample.ndre,
      ndmi: plotSample.ndmi,
      stress: plotSample.stress,
      scl: plotSample.scl,
      pixelCount: plotSample.pixelCount,
      sampleSource: 'plot-mean',
    };
  }

  return { skipped: true, reason: 'No clear pixels near this tree' };
}

/** GEE-style reduceRegion(mean) over plot polygon at 10 m scale */
async function sampleSentinel2Plot(item, polygon) {
  const gridPoints = samplePointsInPolygonAtSpacing(
    polygon,
    SENTINEL_ANALYSIS.scaleMeters,
    SENTINEL_ANALYSIS.maxPlotSamplePoints,
  );
  if (!gridPoints.length) {
    return { skipped: true, reason: 'No sample points inside plot boundary' };
  }

  const pointSamples = await sampleGridInBatches(
    item,
    gridPoints,
    async (scene, lat, lng, point) => {
      const sample = await sampleSentinel2Scene(scene, lat, lng, { sampleMode: 'pixel' });
      if (sample.skipped) return sample;
      return {
        ...sample,
        latitude: point.latitude,
        longitude: point.longitude,
        sampleSource: 'plot-grid',
      };
    },
  );

  if (!pointSamples.length) {
    return { skipped: true, reason: 'Plot area cloud-covered for this scene' };
  }

  const aggregated = aggregatePixelSamples(pointSamples, SENTINEL_ANALYSIS.plotReducer);

  return {
    skipped: false,
    sceneId: item.id,
    sceneDate: item.properties?.datetime?.slice(0, 10) || null,
    cloudCover: item.properties?.['eo:cloud_cover'] ?? null,
    platform: item.properties?.platform || 'Sentinel-2',
    pointSamples,
    sampleSource: 'plot-mean',
    ...aggregated,
  };
}

export async function searchSentinel2Scenes(latitude, longitude, options = {}) {
  return searchSentinel2ScenesForGeometry({
    type: 'Point',
    coordinates: [longitude, latitude],
  }, options);
}

export async function searchSentinel2ScenesForPolygon(polygon, options = {}) {
  if (!polygon?.coordinates?.[0]?.length) {
    throw new Error('Plot boundary polygon is required for Sentinel-2 search.');
  }
  return searchSentinel2ScenesForGeometry(polygon, options);
}

async function searchSentinel2ScenesForGeometry(geometry, options = {}) {
  const {
    limit = 8,
    maxCloudCover = SENTINEL_ANALYSIS.maxCloudCover,
    lookbackDays = SENTINEL_ANALYSIS.lookbackDays,
  } = options;

  const response = await fetch(EARTH_SEARCH_STAC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json' },
    body: JSON.stringify({
      collections: [SENTINEL_COLLECTION],
      intersects: geometry,
      datetime: stacDateRange(lookbackDays),
      query: {
        'eo:cloud_cover': { lt: maxCloudCover },
      },
      sort: [{ field: 'datetime', direction: 'desc' }],
      limit,
    }),
  });

  if (!response.ok) {
    throw new Error(`Sentinel-2 search failed (${response.status})`);
  }

  const payload = await response.json();
  return payload.features || [];
}

export async function sampleSentinel2Scene(item, latitude, longitude, options = {}) {
  const { sampleMode = 'tree' } = options;
  const offsets = sampleMode === 'pixel' ? [[0, 0]] : TREE_SAMPLE_OFFSETS;

  const scl = await readSclClass(item, longitude, latitude, offsets);
  if (scl != null && !isValidScl(scl)) {
    return { skipped: true, reason: 'Cloud or shadow at pixel', scl };
  }

  const [red, nir, redEdge, swir] = await Promise.all([
    readBandValue(getAssetMeta(item, BAND_ASSETS.red), longitude, latitude, true, offsets),
    readBandValue(getAssetMeta(item, BAND_ASSETS.nir), longitude, latitude, true, offsets),
    readBandValue(getAssetMeta(item, BAND_ASSETS.rededge), longitude, latitude, true, offsets),
    readBandValue(getAssetMeta(item, BAND_ASSETS.swir), longitude, latitude, true, offsets),
  ]);

  const ndvi = computeNdvi(nir, red);
  const ndre = computeNdre(nir, redEdge);
  const ndmi = computeNdmi(nir, swir);

  if (ndvi == null && ndre == null && ndmi == null) {
    return { skipped: true, reason: 'No valid reflectance at location' };
  }

  return {
    skipped: false,
    sceneId: item.id,
    sceneDate: item.properties?.datetime?.slice(0, 10) || null,
    cloudCover: item.properties?.['eo:cloud_cover'] ?? null,
    platform: item.properties?.platform || 'Sentinel-2',
    ndvi,
    ndre,
    ndmi,
    stress: computeStressFromNdvi(ndvi),
    scl,
  };
}

/** Legacy single-point fetch — prefer fetchSentinel2ForPlot for orchard lots */
export async function fetchSentinel2ForLocation(latitude, longitude, options = {}) {
  const {
    limit = 24,
    maxCloudCover = SENTINEL_ANALYSIS.maxCloudCover,
    lookbackDays = SENTINEL_ANALYSIS.lookbackDays,
  } = options;

  const scenes = await searchSentinel2Scenes(latitude, longitude, {
    limit,
    maxCloudCover,
    lookbackDays,
  });
  if (!scenes.length) {
    return {
      latest: null,
      history: [],
      error: 'No clear Sentinel-2 scenes found for this location in the last year.',
    };
  }

  const samples = [];
  for (const scene of scenes) {
    try {
      const sample = await sampleSentinel2Scene(scene, latitude, longitude);
      if (!sample.skipped) samples.push(sample);
    } catch {
      // Try the next scene if one band read fails.
    }
  }

  return buildSentinelResult(
    samples,
    'Sentinel-2 scenes exist but pixels at this tree are cloud-covered or unavailable.',
  );
}

/**
 * GEE-equivalent plot workflow (values only):
 * filterBounds(polygon) → filter(cloud<20) → SCL mask → indices → reduceRegion(mean) + tree points
 */
export async function fetchSentinel2ForPlot(polygon, treePoints = [], options = {}) {
  const {
    limit = SENTINEL_ANALYSIS.plotSceneLimit,
    maxCloudCover = SENTINEL_ANALYSIS.maxCloudCover,
    lookbackDays = SENTINEL_ANALYSIS.lookbackDays,
  } = options;

  const scenes = await searchSentinel2ScenesForPolygon(polygon, {
    limit,
    maxCloudCover,
    lookbackDays,
  });

  if (!scenes.length) {
    return {
      plot: {
        latest: null,
        history: [],
        error: 'No clear Sentinel-2 scenes found for this plot in the last year.',
      },
      trees: {},
      error: 'No clear Sentinel-2 scenes found for this plot in the last year.',
    };
  }

  const plotSamples = [];
  const treeSamples = {};
  treePoints.forEach((tree) => {
    treeSamples[tree.treeId] = [];
  });

  for (const scene of scenes) {
    try {
      const plotSample = await sampleSentinel2Plot(scene, polygon);
      const plotPointSamples = plotSample.skipped ? [] : (plotSample.pointSamples || []);
      if (!plotSample.skipped) plotSamples.push(plotSample);

      for (const tree of treePoints) {
        const sample = await sampleSentinel2Tree(
          scene,
          tree.latitude,
          tree.longitude,
          plotPointSamples,
          plotSample.skipped ? null : plotSample,
        );
        if (!sample.skipped) {
          treeSamples[tree.treeId].push(sample);
        }
      }
    } catch {
      // Try the next scene if one read fails.
    }
  }

  const trees = {};
  treePoints.forEach((tree) => {
    const samples = treeSamples[tree.treeId] || [];
    trees[String(tree.treeId)] = buildTreeResultWithPlotFallback(samples, plotSamples);
  });

  const plot = buildSentinelResult(
    plotSamples,
    'Sentinel-2 scenes exist but the plot area is cloud-covered or unavailable.',
  );

  return {
    plot,
    trees,
    error: plot.error,
  };
}

export function buildSentinel2ChartData(history) {
  return (history || []).map((row) => ({
    ...row,
    label: row.label || row.dateKey,
  }));
}

export { SENTINEL_ANALYSIS };
