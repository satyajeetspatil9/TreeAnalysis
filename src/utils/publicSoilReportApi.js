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

export function buildSoilReportCurlExample(accessKey, positionCode, readings = {}) {
  const url = getPublicSoilReportFunctionUrl();
  const body = {
    position_code: positionCode || 'A-R01-L01-T01',
    observed_at: readings.observed_at || new Date().toISOString(),
    moisture_percent: readings.moisture_percent ?? 45,
    ph: readings.ph ?? 6.8,
    ec: readings.ec ?? 0.52,
    temperature_c: readings.temperature_c ?? 28.5,
    nitrogen: readings.nitrogen ?? 350,
    phosphorus: readings.phosphorus ?? 18,
    potassium: readings.potassium ?? 200,
  };

  return `curl -X POST "${url}" ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: ${accessKey || 'ta_YOUR_KEY'}" ^
  -d "${JSON.stringify(body).replace(/"/g, '\\"')}"`;
}
