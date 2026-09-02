const DEFAULT_GPS_ANALYSIS_URL = 'https://orchard-planetary-api.onrender.com/api/gps-analysis';
const UPSTREAM_GPS_ANALYSIS_URL = process.env.REACT_APP_GPS_ANALYSIS_UPSTREAM_URL
  || DEFAULT_GPS_ANALYSIS_URL;
const FETCH_TIMEOUT_MS = 180000;

export function getGpsAnalysisApiUrl() {
  if (process.env.REACT_APP_GPS_ANALYSIS_API_URL) {
    return process.env.REACT_APP_GPS_ANALYSIS_API_URL;
  }

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/gps-satellite-analysis`;
  }

  return DEFAULT_GPS_ANALYSIS_URL;
}

function linkAbortSignals(userSignal, timeoutSignal) {
  if (!userSignal) return timeoutSignal;

  if (userSignal.aborted) {
    timeoutSignal.abort();
    return timeoutSignal;
  }

  const linked = new AbortController();
  const abortLinked = () => linked.abort();
  userSignal.addEventListener('abort', abortLinked);
  timeoutSignal.addEventListener('abort', abortLinked);
  linked.signal.addEventListener('abort', () => {
    userSignal.removeEventListener('abort', abortLinked);
    timeoutSignal.removeEventListener('abort', abortLinked);
  });
  return linked.signal;
}

/**
 * POST gps-analysis — Sentinel-1/2 indices and stress for a tree GPS point.
 * Uses Supabase edge proxy by default (avoids browser CORS to Render).
 */
export async function fetchGpsSatelliteAnalysis({
  treeId,
  latitude,
  longitude,
  daysBack = 10,
  signal,
}) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const linkedSignal = linkAbortSignals(signal, timeoutController.signal);

  const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (supabaseAnonKey && getGpsAnalysisApiUrl().includes('/functions/v1/')) {
    headers.apikey = supabaseAnonKey;
  }

  try {
    const response = await fetch(getGpsAnalysisApiUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tree_id: treeId,
        latitude,
        longitude,
        days_back: daysBack,
      }),
      signal: linkedSignal,
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

    const payload = await response.json();
    if (
      payload
      && typeof payload === 'object'
      && payload.data
      && !payload.indices
      && !payload.radar_stress
      && !payload.selected_images
    ) {
      return payload.data;
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        'Satellite analysis timed out after 3 minutes. Tap Retry — the API may still be waking up.',
      );
    }
    if (err.message === 'Failed to fetch') {
      throw new Error(
        'Could not reach satellite API. Deploy gps-satellite-analysis edge function or check network.',
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
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

export { UPSTREAM_GPS_ANALYSIS_URL };
