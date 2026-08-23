import { getIngestFunctionUrl } from './ingestApiKeys';

export function getPublicSoilReportFunctionUrl() {
  return getIngestFunctionUrl();
}

export function buildPublicSoilReportPageUrl(accessKey, origin = window.location.origin) {
  const key = encodeURIComponent(accessKey || '');
  return `${origin.replace(/\/$/, '')}/add-soil-report?key=${key}`;
}

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function submitPublicSoilReport(accessKey, payload) {
  const res = await fetch(getPublicSoilReportFunctionUrl(), {
    method: 'POST',
    headers: {
      'x-api-key': accessKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}
