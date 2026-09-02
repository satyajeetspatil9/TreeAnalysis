import { supabase } from '../supabaseClient';

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

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.indices || payload.radar_stress || payload.selected_images || payload.data_quality) {
    return payload;
  }
  if (payload.data && typeof payload.data === 'object') {
    return unwrapPayload(payload.data);
  }
  return payload;
}

/**
 * POST gps-analysis — Sentinel-1/2 indices and stress for a tree GPS point.
 * Uses the logged-in Supabase session so the edge proxy accepts the call.
 */
export async function fetchGpsSatelliteAnalysis({
  treeId,
  latitude,
  longitude,
  daysBack = 10,
}) {
  const timeout = new Promise((_, reject) => {
    window.setTimeout(
      () => reject(new Error('Satellite analysis timed out after 3 minutes. Tap Retry — the API may still be waking up.')),
      FETCH_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      supabase.functions.invoke('gps-satellite-analysis', {
        body: {
          tree_id: treeId,
          latitude,
          longitude,
          days_back: daysBack,
        },
      }),
      timeout,
    ]);

    if (result.error) {
      throw new Error(result.error.message || 'Satellite analysis failed');
    }

    const payload = unwrapPayload(result.data);
    if (payload?.error) {
      throw new Error(payload.error);
    }
    return payload;
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      throw new Error(
        'Could not reach satellite API. Deploy gps-satellite-analysis edge function or check network.',
      );
    }
    throw err;
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
