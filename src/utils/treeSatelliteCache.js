import { fetchSentinel2ForLocation } from './sentinel2';

const LOCAL_KEY_PREFIX = 'tree_satellite_cache:';
/** Bump when fetch/classification logic changes so stale cache is refreshed */
const CACHE_SCHEMA_VERSION = 2;

export function getWeekMonday(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function isMonday(date = new Date()) {
  return date.getDay() === 1;
}

export function getNextMondayDate(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  if (day === 1) {
    d.setDate(d.getDate() + 7);
    return d;
  }
  const daysUntil = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + daysUntil);
  return d;
}

export function formatNextMonday(date = new Date()) {
  return getNextMondayDate(date).toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function shouldFetchSentinel2(cache, now = new Date()) {
  if (!cache) return isMonday(now);
  const weekMonday = getWeekMonday(now);
  if (cache.week_start === weekMonday) return false;
  return isMonday(now);
}

function isMissingCacheTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('tree_satellite_cache');
}

function normalizeCache(row) {
  if (!row) return null;
  return {
    week_start: row.week_start,
    fetched_at: row.fetched_at,
    latest: row.latest,
    history: row.history || [],
    error: row.error_message || row.error || null,
    schemaVersion: row.schema_version ?? 1,
  };
}

function isStaleCache(row) {
  if (!row) return false;
  if ((row.schema_version ?? 1) < CACHE_SCHEMA_VERSION) return true;
  if (row.latest && row.latest.scl == null) return true;
  const history = row.history || [];
  return history.length > 0 && history.some((entry) => entry.scl == null);
}

function loadLocalCache(treeId) {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY_PREFIX}${treeId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalCache(treeId, cache) {
  try {
    localStorage.setItem(`${LOCAL_KEY_PREFIX}${treeId}`, JSON.stringify(cache));
  } catch {
    // Ignore quota errors.
  }
}

async function loadCache(supabase, treeId) {
  const { data, error } = await supabase
    .from('tree_satellite_cache')
    .select('*')
    .eq('tree_id', treeId)
    .maybeSingle();

  if (error) {
    if (isMissingCacheTable(error)) {
      return loadLocalCache(treeId);
    }
    throw error;
  }

  return data || loadLocalCache(treeId);
}

async function saveCache(supabase, treeId, weekMonday, latitude, longitude, result) {
  const payload = {
    tree_id: treeId,
    week_start: weekMonday,
    fetched_at: new Date().toISOString(),
    latitude,
    longitude,
    latest: result.latest,
    history: result.history || [],
    error_message: result.error || null,
  };

  const { error } = await supabase.from('tree_satellite_cache').upsert(payload);
  if (error) {
    if (isMissingCacheTable(error)) {
      saveLocalCache(treeId, {
        week_start: weekMonday,
        fetched_at: payload.fetched_at,
        latest: payload.latest,
        history: payload.history,
        error_message: payload.error_message,
        schema_version: CACHE_SCHEMA_VERSION,
      });
      return;
    }
    throw error;
  }
}

function buildResponse(result, meta) {
  return {
    latest: result.latest,
    history: result.history || [],
    error: result.error,
    ...meta,
  };
}

export async function loadSentinel2ForTree(supabase, treeId, latitude, longitude) {
  const rawCache = await loadCache(supabase, treeId);
  const needsSchemaRefresh = isStaleCache(rawCache);
  const cache = needsSchemaRefresh ? null : normalizeCache(rawCache);
  const now = new Date();
  const nextFetchLabel = formatNextMonday(now);

  if (cache && !shouldFetchSentinel2(cache, now)) {
    return buildResponse(cache, {
      fetchedAt: cache.fetched_at,
      weekStart: cache.week_start,
      fromCache: true,
      nextFetchLabel,
      info: isMonday(now)
        ? 'Sentinel-2 already fetched today for this tree.'
        : `Showing cached data. Next fetch: ${nextFetchLabel}.`,
    });
  }

  if (!isMonday(now) && !needsSchemaRefresh) {
    if (cache) {
      return buildResponse(cache, {
        fetchedAt: cache.fetched_at,
        weekStart: cache.week_start,
        fromCache: true,
        nextFetchLabel,
        info: `Sentinel-2 refreshes every Monday. Next fetch: ${nextFetchLabel}.`,
      });
    }

    return buildResponse(
      { latest: null, history: [], error: null },
      {
        fetchedAt: null,
        weekStart: null,
        fromCache: false,
        nextFetchLabel,
        info: `Sentinel-2 fetch runs every Monday. Next fetch: ${nextFetchLabel}.`,
      },
    );
  }

  const result = await fetchSentinel2ForLocation(latitude, longitude);
  const weekMonday = getWeekMonday(now);
  await saveCache(supabase, treeId, weekMonday, latitude, longitude, result);

  return buildResponse(result, {
    fetchedAt: new Date().toISOString(),
    weekStart: weekMonday,
    fromCache: false,
    nextFetchLabel: formatNextMonday(now),
    info: 'Sentinel-2 fetched for this week.',
  });
}
