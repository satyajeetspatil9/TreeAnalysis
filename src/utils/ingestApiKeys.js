const SENSOR_FIELD_KEYS = [
  'moisture_percent',
  'ph',
  'ec',
  'temperature_c',
  'nitrogen',
  'phosphorus',
  'potassium',
];

export { SENSOR_FIELD_KEYS as INGEST_SENSOR_FIELD_KEYS };

export function getIngestFunctionUrl() {
  const base = process.env.REACT_APP_SUPABASE_URL;
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/functions/v1/ingest-sensor-reading`;
}

export function generateIngestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ta_${token}`;
}

export async function hashIngestKey(key) {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ingestKeyPrefix(key) {
  return key.slice(0, 12);
}

import { rawMoistureToPercent } from './soilSensorMoisture';

export function buildIngestSampleJson(positionCode = 'A-R01-L01-T01') {
  return JSON.stringify({
    position_code: positionCode,
    observed_at: new Date().toISOString(),
    moisture_percent: Math.round(rawMoistureToPercent(140)),
    ph: 6.8,
    ec: 0.52,
    temperature_c: 28.5,
    nitrogen: 350,
    phosphorus: 18,
    potassium: 200,
  }, null, 2);
}
