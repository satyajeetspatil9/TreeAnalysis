export function getPublicAddTreeFunctionUrl() {
  const base = process.env.REACT_APP_SUPABASE_URL;
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/functions/v1/public-add-tree`;
}

export function buildPublicAddTreePageUrl(accessKey, origin = window.location.origin) {
  const key = encodeURIComponent(accessKey || '');
  return `${origin.replace(/\/$/, '')}/add-tree?key=${key}`;
}

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchPublicAddTreeBootstrap(accessKey) {
  const res = await fetch(getPublicAddTreeFunctionUrl(), {
    headers: { 'x-api-key': accessKey },
  });
  return parseJsonResponse(res);
}

export async function submitPublicAddTree(accessKey, payload) {
  const res = await fetch(getPublicAddTreeFunctionUrl(), {
    method: 'POST',
    headers: {
      'x-api-key': accessKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}
