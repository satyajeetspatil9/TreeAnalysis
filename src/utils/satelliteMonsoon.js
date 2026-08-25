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
    return 'Cloud cover is above 45%. Optical readings are hidden; only Sentinel-1 radar is shown. During monsoon, satellite readings may not be fully accurate — confirm important decisions with a field visit or soil test.';
  }
  return 'Monsoon season: heavy cloud and rain can make optical satellite readings less accurate. Use alongside soil sensor data and field inspection.';
}
