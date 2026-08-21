import { fetchSentinel2ForPlot } from './sentinel2';
import { parseLotBoundary } from './geo';
import { fetchLotBoundary, fetchLotTreePoints } from './lotSchema';
import { getTreeGps } from './schema';
import {
  formatNextMonday,
  getWeekMonday,
  isMonday,
  shouldFetchSentinel2,
} from './treeSatelliteCache';

const LOCAL_KEY_PREFIX = 'lot_satellite_cache:';
const CACHE_SCHEMA_VERSION = 5;

function getTreeCacheEntry(trees, treeId) {
  if (!trees || treeId == null) return null;
  const key = String(treeId);
  if (trees[key]) return trees[key];
  const match = Object.entries(trees).find(([entryKey]) => String(entryKey) === key);
  return match ? match[1] : null;
}

function deriveTreeResultFromPlot(plot) {
  if (!plot?.latest && !(plot?.history?.length)) {
    return { latest: null, history: [], error: null };
  }

  const history = (plot.history || []).map((row) => ({
    ...row,
    sampleSource: row.sampleSource || 'plot-mean',
  }));
  const latest = plot.latest
    ? { ...plot.latest, sampleSource: plot.latest.sampleSource || 'plot-mean' }
    : null;

  return { latest, history, error: null };
}

function mergeViewingTree(treePoints, viewingTree) {
  const merged = [...treePoints];
  const gps = getTreeGps(viewingTree);
  if (!viewingTree?.id || !gps) return merged;

  const exists = merged.some((point) => String(point.treeId) === String(viewingTree.id));
  if (!exists) {
    merged.push({
      treeId: viewingTree.id,
      latitude: gps.latitude,
      longitude: gps.longitude,
    });
  }
  return merged;
}

function isMissingCacheTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('lot_satellite_cache');
}

function normalizeCache(row) {
  if (!row) return null;
  return {
    week_start: row.week_start,
    fetched_at: row.fetched_at,
    boundary: row.boundary,
    plot: {
      latest: row.plot_latest,
      history: row.plot_history || [],
      error: row.error_message || null,
    },
    trees: row.trees || {},
    error: row.error_message || null,
    schemaVersion: row.schema_version ?? 1,
  };
}

function isStaleCache(row, boundary) {
  if (!row) return false;
  if ((row.schema_version ?? 1) < CACHE_SCHEMA_VERSION) return true;
  if (boundary && row.boundary && JSON.stringify(row.boundary) !== JSON.stringify(boundary)) {
    return true;
  }
  return false;
}

function loadLocalCache(lotId) {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY_PREFIX}${lotId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalCache(lotId, cache) {
  try {
    localStorage.setItem(`${LOCAL_KEY_PREFIX}${lotId}`, JSON.stringify(cache));
  } catch {
    // Ignore quota errors.
  }
}

async function loadCache(supabase, lotId) {
  const { data, error } = await supabase
    .from('lot_satellite_cache')
    .select('*')
    .eq('lot_id', lotId)
    .maybeSingle();

  if (error) {
    if (isMissingCacheTable(error)) {
      return loadLocalCache(lotId);
    }
    throw error;
  }

  return data || loadLocalCache(lotId);
}

async function saveCache(supabase, lotId, weekMonday, boundary, result) {
  const payload = {
    lot_id: lotId,
    week_start: weekMonday,
    fetched_at: new Date().toISOString(),
    boundary,
    plot_latest: result.plot?.latest || null,
    plot_history: result.plot?.history || [],
    trees: result.trees || {},
    error_message: result.error || result.plot?.error || null,
  };

  const { error } = await supabase.from('lot_satellite_cache').upsert(payload);
  if (error) {
    if (isMissingCacheTable(error)) {
      saveLocalCache(lotId, {
        ...payload,
        schema_version: CACHE_SCHEMA_VERSION,
      });
      return;
    }
    throw error;
  }
}

function buildTreeResponse(cache, treeId, meta) {
  const plot = cache?.plot || { latest: null, history: [], error: null };
  let treeResult = getTreeCacheEntry(cache?.trees, treeId);

  if (!treeResult?.latest && !treeResult?.history?.length) {
    treeResult = deriveTreeResultFromPlot(plot);
  }

  const hasTreeData = !!(treeResult?.latest || treeResult?.history?.length);
  return {
    latest: treeResult?.latest || null,
    history: treeResult?.history || [],
    error: hasTreeData ? null : (treeResult?.error || plot.error || null),
    plot,
    ...meta,
  };
}

export async function loadSentinel2ForLot(supabase, lotId, treeId, options = {}, viewingTree = null) {
  const { forceRefresh = false } = options;
  const boundary = await fetchLotBoundary(supabase, lotId);
  if (!boundary) {
    return {
      latest: null,
      history: [],
      error: 'Plot boundary is not set for this lot. Add 4 corner coordinates in Farm Setup.',
      plot: { latest: null, history: [], error: null },
      fetchedAt: null,
      fromCache: false,
      info: null,
      nextFetchLabel: formatNextMonday(),
      usesPlotFetch: false,
    };
  }

  const treePoints = mergeViewingTree(await fetchLotTreePoints(supabase, lotId), viewingTree);
  const rawCache = await loadCache(supabase, lotId);
  const needsSchemaRefresh = isStaleCache(rawCache, boundary);
  const cache = needsSchemaRefresh ? null : normalizeCache(rawCache);
  const now = new Date();
  const nextFetchLabel = formatNextMonday(now);

  if (cache && !forceRefresh && !shouldFetchSentinel2(cache, now)) {
    return buildTreeResponse(cache, treeId, {
      fetchedAt: cache.fetched_at,
      weekStart: cache.week_start,
      fromCache: true,
      nextFetchLabel,
      usesPlotFetch: true,
      info: isMonday(now)
        ? 'Plot Sentinel-2 already fetched today for this lot.'
        : `Showing cached plot data. Next scheduled fetch: ${nextFetchLabel}.`,
    });
  }

  const canAutoFetch = isMonday(now) || needsSchemaRefresh || !cache;
  if (!canAutoFetch && !forceRefresh) {
    if (cache) {
      return buildTreeResponse(cache, treeId, {
        fetchedAt: cache.fetched_at,
        weekStart: cache.week_start,
        fromCache: true,
        nextFetchLabel,
        usesPlotFetch: true,
        info: `Showing cached plot data. Next scheduled fetch: ${nextFetchLabel}.`,
      });
    }

    return {
      latest: null,
      history: [],
      error: null,
      plot: { latest: null, history: [], error: null },
      fetchedAt: null,
      weekStart: null,
      fromCache: false,
      nextFetchLabel,
      usesPlotFetch: true,
      info: `No plot data yet. Use Fetch now, or wait until ${nextFetchLabel}.`,
    };
  }

  const result = await fetchSentinel2ForPlot(boundary, treePoints);
  const weekMonday = getWeekMonday(now);
  await saveCache(supabase, lotId, weekMonday, boundary, result);

  const savedCache = normalizeCache({
    week_start: weekMonday,
    fetched_at: new Date().toISOString(),
    boundary,
    plot_latest: result.plot?.latest,
    plot_history: result.plot?.history,
    trees: result.trees,
    error_message: result.error || result.plot?.error,
    schema_version: CACHE_SCHEMA_VERSION,
  });

  return buildTreeResponse(savedCache, treeId, {
    fetchedAt: savedCache.fetched_at,
    weekStart: weekMonday,
    fromCache: false,
    nextFetchLabel: formatNextMonday(now),
    usesPlotFetch: true,
    info: forceRefresh
      ? 'Plot Sentinel-2 refreshed manually for this lot.'
      : 'Plot Sentinel-2 fetched for this week (shared across all trees in lot).',
  });
}

export async function loadSentinel2ForTreeFromPlot(supabase, tree, options = {}) {
  const lotId = tree?.tree_positions?.lot_id;
  if (!lotId) {
    return {
      latest: null,
      history: [],
      error: 'Tree is not linked to a lot. Assign a lot before fetching plot satellite data.',
      plot: { latest: null, history: [], error: null },
      fetchedAt: null,
      fromCache: false,
      info: null,
      nextFetchLabel: formatNextMonday(),
      usesPlotFetch: false,
    };
  }

  return loadSentinel2ForLot(supabase, lotId, tree.id, options, tree);
}
