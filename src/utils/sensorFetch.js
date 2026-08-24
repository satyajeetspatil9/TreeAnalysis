/**
 * Fetch 7-in-1 readings from SoilSensorReader ESP32 via Web Bluetooth,
 * or demo data when REACT_APP_SENSOR_DEMO=true (desktop dev without hardware).
 *
 * UUID contract: SoilSensorReader docs/GATT_CONTRACT.md
 */
import {
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeReadings(raw) {
  const observedAt = raw?.observed_at;
  const useToday = !observedAt || observedAt.startsWith('1970');
  return {
    observed_at: useToday ? todayIsoDate() : observedAt,
    moisture_percent: Number(raw.moisture_percent),
    ph: Number(raw.ph),
    ec: Number(raw.ec),
    temperature_c: Number(raw.temperature_c),
    nitrogen: Number(raw.nitrogen),
    phosphorus: Number(raw.phosphorus),
    potassium: Number(raw.potassium),
  };
}

async function fetchDemoReadings() {
  await new Promise((resolve) => { window.setTimeout(resolve, 600); });
  return {
    observed_at: todayIsoDate(),
    ...DEMO_SENSOR_READINGS,
  };
}

async function fetchBleReadings() {
  if (!navigator.bluetooth) {
    throw new Error(
      'Web Bluetooth is not available. Use Chrome on Android near the SoilSensor reader.',
    );
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SOIL_SERVICE_UUID] }],
    optionalServices: [SOIL_SERVICE_UUID],
  });

  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(SOIL_SERVICE_UUID);
    const readingsChar = await service.getCharacteristic(SOIL_READINGS_CHAR_UUID);

    try {
      const triggerChar = await service.getCharacteristic(SOIL_TRIGGER_CHAR_UUID);
      await triggerChar.writeValue(new Uint8Array([0x01]));
      await new Promise((resolve) => { window.setTimeout(resolve, 300); });
    } catch {
      // Trigger characteristic is optional on older firmware.
    }

    const value = await readingsChar.readValue();
    const text = new TextDecoder().decode(value.buffer);
    const parsed = JSON.parse(text);
    const normalized = normalizeReadings(parsed);
    normalized._deviceName = device.name || 'SoilSensor';
    return normalized;
  } finally {
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
