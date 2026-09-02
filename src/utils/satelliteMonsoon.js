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

export function isRadarUsable(analysis) {
  if (!analysis) return false;
  const status = String(
    analysis.radar_stress?.status
    || analysis.index_status?.S1_VV
    || '',
  ).trim().toLowerCase();
  if (!status || status === 'no data' || status === 'nodata' || status.includes('no data')) {
    return false;
  }
  const vv = analysis.indices?.S1_VV;
  const db = analysis.selected_images?.sentinel1?.vv_db;
  return vv != null || db != null;
}

export function extractRadarSlice(analysis) {
  if (!isRadarUsable(analysis)) return null;
  return {
    radar_stress: analysis.radar_stress ?? null,
    index_status: { S1_VV: analysis.index_status?.S1_VV ?? null },
    indices: { S1_VV: analysis.indices?.S1_VV ?? null },
    selected_images: {
      sentinel1: analysis.selected_images?.sentinel1 ?? null,
    },
    period: analysis.period ?? null,
  };
}

/** Current week's radar if usable; otherwise the stored last-good Sentinel-1 slice. */
export function resolveRadarAnalysis(currentAnalysis, lastGoodRadar) {
  if (isRadarUsable(currentAnalysis)) {
    return { analysis: currentAnalysis, fromPriorWeek: false };
  }
  if (isRadarUsable(lastGoodRadar)) {
    return { analysis: lastGoodRadar, fromPriorWeek: true };
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
    return 'Cloud cover is above 45%. Optical readings are hidden by default; only Sentinel-1 radar is shown (or the latest earlier good radar if this week has none). Use Show optical to see Sentinel-2 anyway. During monsoon, confirm important decisions with a field visit or soil test.';
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
