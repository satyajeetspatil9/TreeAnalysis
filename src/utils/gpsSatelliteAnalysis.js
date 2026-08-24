const DEFAULT_GPS_ANALYSIS_URL = 'https://orchard-planetary-api.onrender.com/api/gps-analysis';

export function getGpsAnalysisApiUrl() {
  return process.env.REACT_APP_GPS_ANALYSIS_API_URL || DEFAULT_GPS_ANALYSIS_URL;
}

/**
 * POST /api/gps-analysis — Sentinel-1/2 indices and stress for a tree GPS point.
 */
export async function fetchGpsSatelliteAnalysis({
  treeId,
  latitude,
  longitude,
  daysBack = 10,
  signal,
}) {
  const response = await fetch(getGpsAnalysisApiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tree_id: treeId,
      latitude,
      longitude,
      days_back: daysBack,
    }),
    signal,
  });

  if (!response.ok) {
    let message = `Satellite analysis failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.error || body.message || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  return response.json();
}

export function severityChipColor(severity) {
  const value = String(severity || '').toLowerCase();
  if (value.includes('high') || value.includes('attention') || value.includes('severe')) {
    return 'error';
  }
  if (value.includes('moderate') || value.includes('medium')) {
    return 'warning';
  }
  if (value.includes('low') || value.includes('no significant') || value.includes('good')) {
    return 'success';
  }
  return 'default';
}
