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

export const DEMO_SENSOR_READINGS = {
  moisture_percent: 45,
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

function pickNumber(raw, keys) {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      return Number(raw[key]);
    }
  }
  return Number.NaN;
}

function normalizeReadings(raw) {
  const observedAt = raw?.observed_at;
  const useToday = !observedAt || String(observedAt).startsWith('1970');
  const moisture = pickNumber(raw, ['moisture_percent', 'humidity', 'moisture']);
  const temperature = pickNumber(raw, ['temperature_c', 'temperature']);
  const ph = pickNumber(raw, ['ph', 'pH']);
  const ec = pickNumber(raw, ['ec', 'EC']);

  if ([moisture, ph, ec, temperature].some((value) => Number.isNaN(value))) {
    throw new Error('Sensor JSON is missing moisture, pH, EC, or temperature.');
  }

  return {
    observed_at: useToday ? todayIsoDate() : observedAt,
    moisture_percent: moisture,
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

async function fetchBleReadings() {
  if (!navigator.bluetooth) {
    throw new Error(
      'Web Bluetooth is not available. Use Chrome on Android near the SoilSensor reader (RDL908).',
    );
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [
      { services: [SOIL_SERVICE_UUID] },
      { namePrefix: SOIL_BLE_NAME_PREFIX },
    ],
    optionalServices: [SOIL_SERVICE_UUID],
  });

  const server = await device.gatt.connect();
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
