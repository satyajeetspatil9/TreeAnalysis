import { formatNextMonday, getWeekMonday } from './treeSatelliteCache';

export { getWeekMonday, formatNextMonday };

const BATCH_FUNCTION = 'refresh-gps-satellite-batch';

function isMissingTable(error) {
  const message = error?.message || '';
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || message.includes('tree_gps_satellite_cache');
}

export function parseCachedAnalysis(analysis) {
  if (analysis == null) return null;
  if (typeof analysis === 'string') {
    try {
      return JSON.parse(analysis);
    } catch {
      return null;
    }
  }
  return analysis;
}

export async function loadCachedGpsAnalysis(supabase, positionId) {
  if (!positionId) {
    return { analysis: null, cache: null, error: 'Missing tree position.' };
  }

  const { data, error } = await supabase
    .from('tree_gps_satellite_cache')
    .select('*')
    .eq('position_id', positionId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      return {
        analysis: null,
        cache: null,
        error: 'Run migration 035_tree_gps_satellite_cache.sql in Supabase SQL Editor.',
      };
    }
    return { analysis: null, cache: null, error: error.message };
  }

  if (!data) {
    return {
      analysis: null,
      cache: null,
      error: null,
      empty: true,
      weekStart: getWeekMonday(),
      nextFetchLabel: formatNextMonday(),
    };
  }

  let analysis = parseCachedAnalysis(data.analysis);

  return {
    analysis,
    cache: data,
    error: data.error_message,
    empty: !data.analysis,
    weekStart: data.week_start,
    fetchedAt: data.fetched_at,
    lastGoodRadar: parseCachedAnalysis(data.last_good_radar),
    lastGoodRadarWeek: data.last_good_radar_week || null,
    fromCache: true,
    nextFetchLabel: formatNextMonday(),
  };
}

export async function saveLastGoodRadar(supabase, positionId, lastGoodRadar, lastGoodRadarWeek) {
  if (!positionId || !lastGoodRadar) {
    return { error: 'Missing radar cache target.' };
  }

  const { error } = await supabase
    .from('tree_gps_satellite_cache')
    .update({
      last_good_radar: lastGoodRadar,
      last_good_radar_week: lastGoodRadarWeek,
      updated_at: new Date().toISOString(),
    })
    .eq('position_id', positionId);

  return { error: error?.message || null };
}

export async function fetchGpsSatelliteStats(supabase, farmId) {
  const { data, error } = await supabase.functions.invoke(BATCH_FUNCTION, {
    body: { farm_id: farmId, stats_only: true },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function refreshGpsSatelliteBatch(supabase, farmId, options = {}) {
  const {
    afterPositionId = 0,
    limit = 1,
    force = false,
    daysBack = 10,
  } = options;

  const { data, error } = await supabase.functions.invoke(BATCH_FUNCTION, {
    body: {
      farm_id: farmId,
      after_position_id: afterPositionId,
      limit,
      force,
      days_back: daysBack,
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Run batch refresh until all trees with GPS are cached for this week.
 * Processes one tree per edge call (~1–2 min each). Use from Settings with progress UI.
 */
export async function runWeeklyGpsSatelliteRefresh(supabase, farmId, options = {}) {
  const {
    onProgress,
    signal,
    force = false,
    limit = 1,
  } = options;

  let afterPositionId = 0;
  let lastResult = null;

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Refresh cancelled', 'AbortError');
    }

    const result = await refreshGpsSatelliteBatch(supabase, farmId, {
      afterPositionId,
      limit,
      force,
    });

    lastResult = result;
    onProgress?.(result);

    if (result.done || !result.processed_count) {
      break;
    }

    afterPositionId = result.next_after_position_id ?? afterPositionId;
  }

  return lastResult;
}
