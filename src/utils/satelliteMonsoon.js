export const CLOUD_COVER_RADAR_ONLY_THRESHOLD = 45;

function parseCloudPercent(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/%$/, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    return num <= 1 ? num * 100 : num;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num <= 1 ? num * 100 : num;
}

export function getCloudCoverPercent(analysis) {
  const s2 = analysis?.selected_images?.sentinel2;
  if (!s2) return null;

  const candidates = [
    s2.cloud_cover,
    s2.cloudCover,
    s2['eo:cloud_cover'],
    analysis?.data_quality?.cloud_cover,
  ];

  for (const candidate of candidates) {
    const parsed = parseCloudPercent(candidate);
    if (parsed != null) return parsed;
  }

  return null;
}

function isFiniteNumber(value) {
  if (value == null || value === '') return false;
  return Number.isFinite(Number(value));
}

function unwrapGpsAnalysis(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.indices || payload.radar_stress || payload.selected_images || payload.data_quality || payload.index_status) {
    return payload;
  }
  if (payload.data && typeof payload.data === 'object') {
    return unwrapGpsAnalysis(payload.data);
  }
  return payload;
}

export function hasRadarNumericValues(analysis) {
  const payload = unwrapGpsAnalysis(analysis);
  if (!payload) return false;
  return isFiniteNumber(payload.indices?.S1_VV)
    || isFiniteNumber(payload.indices?.s1_vv)
    || isFiniteNumber(payload.selected_images?.sentinel1?.vv_db)
    || isFiniteNumber(payload.selected_images?.sentinel1?.VV);
}

export function isRadarStatusNoData(analysis) {
  const payload = unwrapGpsAnalysis(analysis);
  const status = String(
    payload?.radar_stress?.status
    || payload?.index_status?.S1_VV
    || '',
  ).trim().toLowerCase();
  return !status || status === 'no data' || status === 'nodata' || status.includes('no data');
}

/** Fresh this-week radar: numeric values and a real status (not "No data"). */
export function isRadarUsable(analysis) {
  return hasRadarNumericValues(analysis) && !isRadarStatusNoData(analysis);
}

export function extractRadarSlice(analysis) {
  const payload = unwrapGpsAnalysis(analysis);
  if (!hasRadarNumericValues(payload)) return null;
  return {
    radar_stress: payload.radar_stress ?? null,
    index_status: { S1_VV: payload.index_status?.S1_VV ?? null },
    indices: { S1_VV: payload.indices?.S1_VV ?? payload.indices?.s1_vv ?? null },
    selected_images: {
      sentinel1: payload.selected_images?.sentinel1 ?? null,
    },
    period: payload.period ?? null,
  };
}

export function radarObservationDate(radarAnalysis, storedWeek = null) {
  const s1Date = radarAnalysis?.selected_images?.sentinel1?.date;
  return storedWeek
    || (typeof s1Date === 'string' ? s1Date.slice(0, 10) : null)
    || radarAnalysis?.period?.end
    || radarAnalysis?.period?.start
    || null;
}

/** Current week's radar if usable; otherwise last-good / stale numbers in this payload. */
export function resolveRadarAnalysis(currentAnalysis, lastGoodRadar) {
  if (isRadarUsable(currentAnalysis)) {
    return { analysis: currentAnalysis, fromPriorWeek: false };
  }
  if (hasRadarNumericValues(lastGoodRadar)) {
    return { analysis: lastGoodRadar, fromPriorWeek: true };
  }
  if (hasRadarNumericValues(currentAnalysis)) {
    return { analysis: currentAnalysis, fromPriorWeek: true };
  }
  return { analysis: currentAnalysis, fromPriorWeek: false };
}

export function isRadarOnlyMode(analysis) {
  if (!analysis) return false;
  const cloud = getCloudCoverPercent(analysis);
  if (cloud == null) return !analysis?.selected_images?.sentinel2;
  return cloud > CLOUD_COVER_RADAR_ONLY_THRESHOLD;
}

export function isMonsoonSeason(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return false;
  const month = date.getMonth() + 1;
  return month >= 6 && month <= 9;
}

export function getAnalysisSeasonDate(analysis, weekStart) {
  return analysis?.period?.end
    || analysis?.period?.start
    || weekStart
    || null;
}

export function shouldShowMonsoonDisclaimer(analysis, weekStart) {
  if (isRadarOnlyMode(analysis)) return false;
  return isMonsoonSeason(getAnalysisSeasonDate(analysis, weekStart));
}

export function monsoonDisclaimer(variant) {
  if (variant === 'radar-only') {
    return 'Cloud cover is above 45%. Optical readings are hidden by default; Sentinel-1 radar is shown, including the latest earlier pass when this week has none. Use Show optical to see Sentinel-2 anyway. During monsoon, confirm important decisions with a field visit or soil test.';
  }
  return 'Monsoon season: heavy cloud and rain can make optical satellite readings less accurate. Use alongside soil sensor data and field inspection.';
}

const HIDE_OPTICAL_WHEN_CLOUDY_KEY = 'ta.satellite.hideOpticalWhenCloudy';

export function readHideOpticalWhenCloudy() {
  try {
    const raw = window.localStorage.getItem(HIDE_OPTICAL_WHEN_CLOUDY_KEY);
    if (raw == null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

export function writeHideOpticalWhenCloudy(hide) {
  try {
    window.localStorage.setItem(HIDE_OPTICAL_WHEN_CLOUDY_KEY, hide ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}
