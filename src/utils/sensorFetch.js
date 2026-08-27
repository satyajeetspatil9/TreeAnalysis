/**
 * Fetch 7-in-1 readings from SoilSensorReader (RDL908) via Web Bluetooth,
 * or demo data when REACT_APP_SENSOR_DEMO=true (desktop without hardware).
 *
 * UUID contract: SoilSensorReader docs/GATT_CONTRACT.md
 */
import {
  SOIL_BLE_NAME_PREFIX,
  SOIL_READINGS_CHAR_UUID,
  SOIL_SERVICE_UUID,
  SOIL_TRIGGER_CHAR_UUID,
} from './soilSensorBle';
import { rawMoistureToPercent } from './soilSensorMoisture';

export const DEMO_SENSOR_RAW_M = 140;

export const DEMO_SENSOR_READINGS = {
  moisture_percent: Math.round(rawMoistureToPercent(DEMO_SENSOR_RAW_M)),
  ph: 6.8,
  ec: 0.52,
  temperature_c: 28.5,
  nitrogen: 350,
  phosphorus: 18,
  potassium: 200,
};

const SENSOR_DEMO = process.env.REACT_APP_SENSOR_DEMO === 'true';
const NOTIFY_TIMEOUT_MS = 2500;
const READ_FALLBACK_MS = 800;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function decodeCharacteristicValue(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  return new TextDecoder().decode(bytes);
}

function parseReadingsJson(text) {
  const trimmed = String(text || '').replace(/\0/g, '').trim();
  if (!trimmed || trimmed === '{}') {
    return null;
  }
  return JSON.parse(trimmed);
}

function pickNumber(source, keys) {
  if (!source) return Number.NaN;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      const num = Number(source[key]);
      if (!Number.isNaN(num)) return num;
    }
  }
  return Number.NaN;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value != null && !Number.isNaN(Number(value))) return Number(value);
  }
  return null;
}

function normalizeReadings(raw) {
  const observedAt = raw?.observed_at;
  const useToday = !observedAt || String(observedAt).startsWith('1970');
  const firmwareMoisture = pickNumber(raw, ['moisture_percent', 'humidity', 'moisture']);
  const rawM = firstFiniteNumber(
    pickNumber(raw?.raw, ['m']),
    pickNumber(raw, ['m', 'raw_m']),
    Number.isNaN(firmwareMoisture) ? null : firmwareMoisture * 10,
  );
  const moisture = rawMoistureToPercent(rawM) ?? firmwareMoisture;
  const temperature = pickNumber(raw, ['temperature_c', 'temperature']);
  const ph = pickNumber(raw, ['ph', 'pH']);
  const ec = pickNumber(raw, ['ec', 'EC']);

  if ([moisture, ph, ec, temperature].some((value) => Number.isNaN(value))) {
    throw new Error('Sensor JSON is missing moisture, pH, EC, or temperature.');
  }

  return {
    observed_at: useToday ? todayIsoDate() : observedAt,
    moisture_percent: Math.round(moisture),
    moisture_raw_m: rawM,
    ph,
    ec,
    temperature_c: temperature,
    nitrogen: pickNumber(raw, ['nitrogen', 'n']),
    phosphorus: pickNumber(raw, ['phosphorus', 'p']),
    potassium: pickNumber(raw, ['potassium', 'k']),
  };
}

async function fetchDemoReadings() {
  await new Promise((resolve) => { window.setTimeout(resolve, 600); });
  return {
    observed_at: todayIsoDate(),
    ...DEMO_SENSOR_READINGS,
  };
}

function waitForReadingsNotify(characteristic, timeoutMs) {
  return new Promise((resolve) => {
    const onValue = (event) => {
      window.clearTimeout(timer);
      characteristic.removeEventListener('characteristicvaluechanged', onValue);
      try {
        resolve(parseReadingsJson(decodeCharacteristicValue(event.target.value)));
      } catch {
        resolve(null);
      }
    };
    const timer = window.setTimeout(() => {
      characteristic.removeEventListener('characteristicvaluechanged', onValue);
      resolve(null);
    }, timeoutMs);
    characteristic.addEventListener('characteristicvaluechanged', onValue);
  });
}

async function writeTrigger(characteristic) {
  const payload = new Uint8Array([0x01]);
  if (typeof characteristic.writeValueWithResponse === 'function') {
    await characteristic.writeValueWithResponse(payload);
    return;
  }
  await characteristic.writeValue(payload);
}

async function readCachedReadings(characteristic) {
  const value = await characteristic.readValue();
  return parseReadingsJson(decodeCharacteristicValue(value));
}

/**
 * Chrome shows its device chooser on every requestDevice() call, so hold the
 * granted device and reuse it. Survives repeat fetches; a page reload resets it
 * unless chrome://flags/#enable-web-bluetooth-new-permissions-backend is on,
 * which is what makes getDevices() return previously granted devices.
 */
let grantedDevice = null;

async function restoreGrantedDevice() {
  if (grantedDevice) {
    return grantedDevice;
  }
  if (typeof navigator.bluetooth.getDevices !== 'function') {
    return null;
  }
  try {
    const devices = await navigator.bluetooth.getDevices();
    grantedDevice = devices.find((d) => String(d.name || '').startsWith(SOIL_BLE_NAME_PREFIX)) || null;
  } catch {
    grantedDevice = null;
  }
  return grantedDevice;
}

export function forgetSensorDevice() {
  grantedDevice = null;
}

async function acquireDevice() {
  const known = await restoreGrantedDevice();
  if (known) {
    return known;
  }
  grantedDevice = await navigator.bluetooth.requestDevice({
    filters: [
      { services: [SOIL_SERVICE_UUID] },
      { namePrefix: SOIL_BLE_NAME_PREFIX },
    ],
    optionalServices: [SOIL_SERVICE_UUID],
  });
  return grantedDevice;
}

async function fetchBleReadings() {
  if (!navigator.bluetooth) {
    throw new Error(
      'Web Bluetooth is not available. Use Chrome on Android near the SoilSensor reader (RDL908).',
    );
  }

  const device = await acquireDevice();

  let server;
  try {
    server = await device.gatt.connect();
  } catch {
    // A remembered device may be out of range or powered off. Drop it so the
    // next tap opens the chooser again; re-requesting here would fail because
    // the user gesture has already expired.
    forgetSensorDevice();
    throw new Error(
      `Could not connect to ${device.name || SOIL_BLE_NAME_PREFIX}. Power the RDL908, move closer, then tap again.`,
    );
  }

  let readingsChar;
  try {
    const service = await server.getPrimaryService(SOIL_SERVICE_UUID);
    readingsChar = await service.getCharacteristic(SOIL_READINGS_CHAR_UUID);

    let parsed = null;
    try {
      await readingsChar.startNotifications();
    } catch {
      // Read fallback still works if notify is unsupported.
    }

    try {
      const triggerChar = await service.getCharacteristic(SOIL_TRIGGER_CHAR_UUID);
      const notifyPromise = waitForReadingsNotify(readingsChar, NOTIFY_TIMEOUT_MS);
      await writeTrigger(triggerChar);
      parsed = await notifyPromise;
    } catch {
      // Trigger characteristic is optional on older firmware.
    }

    if (!parsed) {
      await new Promise((resolve) => { window.setTimeout(resolve, READ_FALLBACK_MS); });
      parsed = await readCachedReadings(readingsChar);
    }

    if (!parsed) {
      throw new Error(
        'No sensor JSON from SoilSensor-XXXX. Power the RDL908 and probe, then retry.',
      );
    }

    const normalized = normalizeReadings(parsed);
    normalized._deviceName = device.name || SOIL_BLE_NAME_PREFIX;
    if (parsed.raw && typeof parsed.raw === 'object') {
      normalized._raw = parsed.raw;
    }
    return normalized;
  } finally {
    if (readingsChar) {
      try {
        await readingsChar.stopNotifications();
      } catch {
        // Ignore teardown errors.
      }
    }
    if (device.gatt.connected) {
      device.gatt.disconnect();
    }
  }
}

export function isSensorDemoMode() {
  return SENSOR_DEMO;
}

export function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

export async function fetchSensorReadings() {
  if (SENSOR_DEMO) {
    return fetchDemoReadings();
  }
  return fetchBleReadings();
}
