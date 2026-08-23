export function getPublicGrowthFunctionUrl() {
  const base = process.env.REACT_APP_SUPABASE_URL;
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/functions/v1/ingest-tree-growth`;
}

export function buildPublicGrowthPageUrl(accessKey, origin = window.location.origin) {
  const key = encodeURIComponent(accessKey || '');
  return `${origin.replace(/\/$/, '')}/add-growth?key=${key}`;
}

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function submitPublicGrowthMeasurement(accessKey, payload) {
  const res = await fetch(getPublicGrowthFunctionUrl(), {
    method: 'POST',
    headers: {
      'x-api-key': accessKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}
