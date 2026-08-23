/** Placeholder sensor fetch until ESP32 / BLE integration. */

export const DEMO_SENSOR_READINGS = {
  moisture_percent: 45,
  ph: 6.8,
  ec: 0.52,
  temperature_c: 28.5,
  nitrogen: 350,
  phosphorus: 18,
  potassium: 200,
};

export async function fetchSensorReadings() {
  await new Promise((resolve) => { window.setTimeout(resolve, 600); });
  return {
    observed_at: new Date().toISOString().slice(0, 10),
    ...DEMO_SENSOR_READINGS,
  };
}
