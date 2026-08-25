export const CLOUD_COVER_RADAR_ONLY_THRESHOLD = 35;

export function getCloudCoverPercent(analysis) {
  const cloud = analysis?.selected_images?.sentinel2?.cloud_cover;
  if (cloud == null || cloud === '') return null;
  const num = Number(cloud);
  return Number.isFinite(num) ? num : null;
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
    return 'Cloud cover is above 35%. Optical readings are hidden; only Sentinel-1 radar is shown. During monsoon, satellite readings may not be fully accurate — confirm important decisions with a field visit or soil test.';
  }
  return 'Monsoon season: heavy cloud and rain can make optical satellite readings less accurate. Use alongside soil sensor data and field inspection.';
}
