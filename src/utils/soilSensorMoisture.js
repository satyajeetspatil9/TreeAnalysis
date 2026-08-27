/** JXBS-3001-TR raw Modbus moisture register (`raw.m`) → display % scale. */

export const MOISTURE_RAW_MIN = 30;
export const MOISTURE_RAW_MAX = 250;
export const MOISTURE_ADEQUATE_MIN_M = 100;
export const MOISTURE_ADEQUATE_MAX_M = 180;

export function rawMoistureToPercent(rawM) {
  if (rawM == null || rawM === '' || Number.isNaN(Number(rawM))) return null;
  const m = Number(rawM);
  if (m <= MOISTURE_RAW_MIN) return 0;
  if (m >= MOISTURE_RAW_MAX) return 100;
  return ((m - MOISTURE_RAW_MIN) / (MOISTURE_RAW_MAX - MOISTURE_RAW_MIN)) * 100;
}

export function moisturePercentToRawM(percent) {
  if (percent == null || percent === '' || Number.isNaN(Number(percent))) return null;
  const pct = Number(percent);
  if (pct <= 0) return MOISTURE_RAW_MIN;
  if (pct >= 100) return MOISTURE_RAW_MAX;
  return MOISTURE_RAW_MIN + (pct / 100) * (MOISTURE_RAW_MAX - MOISTURE_RAW_MIN);
}

export function evaluateRawMoistureM(rawM) {
  if (rawM == null || Number.isNaN(Number(rawM))) {
    return { status: 'unknown', label: '' };
  }
  const m = Number(rawM);
  if (m < MOISTURE_ADEQUATE_MIN_M) return { status: 'low', label: 'Low' };
  if (m > MOISTURE_ADEQUATE_MAX_M) return { status: 'high', label: 'High' };
  return { status: 'good', label: 'Adequate' };
}

export const MOISTURE_PERCENT_ADEQUATE_MIN = rawMoistureToPercent(MOISTURE_ADEQUATE_MIN_M);
export const MOISTURE_PERCENT_ADEQUATE_MAX = rawMoistureToPercent(MOISTURE_ADEQUATE_MAX_M);
