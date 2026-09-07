import { calculateDailyGDD } from './farmClimateLogic';

/** Demo sensors from FarmClimateGUI when this farm has no weather/soil yet. */
export const MOCK_CLIMATE_SENSORS = {
  Air_Temperature: 28.5,
  Humidity: 92,
  Soil_Moisture: 65,
  Leaf_wetness: 9,
  Lux: 3500,
  Rain_mm: 2.5,
  Wind_speed: 13.5,
  Wind_direction: 180,
  Soil_Temperature: 26.2,
};

export const MOCK_CLIMATE_GDD = 400;

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dayKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

export function cumulativeGddFromWeather(rows) {
  const year = new Date().getFullYear();
  const byDay = new Map();
  (rows || []).forEach((row) => {
    const key = dayKey(row.observed_at);
    const temp = num(row.temperature_c);
    if (!key || temp == null || !key.startsWith(String(year))) return;
    if (!byDay.has(key)) byDay.set(key, temp);
  });
  let total = 0;
  byDay.forEach((temp) => {
    total += calculateDailyGDD(temp, temp);
  });
  return total;
}

export function isHighMoistureThreeDays(soilRows) {
  const recent = (soilRows || [])
    .map((row) => ({ day: dayKey(row.observed_at), moisture: num(row.moisture_percent) }))
    .filter((row) => row.day && row.moisture != null);
  const uniqueDays = [];
  const seen = new Set();
  recent.forEach((row) => {
    if (seen.has(row.day)) return;
    seen.add(row.day);
    uniqueDays.push(row);
  });
  const lastThree = uniqueDays.slice(0, 3);
  return lastThree.length >= 3 && lastThree.every((row) => row.moisture > 75);
}

export function rowsToSensors(weather, soil) {
  return {
    Air_Temperature: num(weather?.temperature_c) ?? 0,
    Humidity: num(weather?.humidity_percent) ?? 0,
    Soil_Moisture: num(soil?.moisture_percent) ?? 0,
    Leaf_wetness: 0,
    Lux: 0,
    Rain_mm: num(weather?.rainfall_mm) ?? 0,
    Wind_speed: num(weather?.wind_speed_kph) ?? 0,
    Wind_direction: num(weather?.wind_direction_deg) ?? 0,
    Soil_Temperature: num(weather?.temperature_c) ?? 0,
  };
}

export async function loadFarmClimateSnapshot(supabase, farmId) {
  if (!farmId) {
    return {
      sensors: MOCK_CLIMATE_SENSORS,
      gdd: MOCK_CLIMATE_GDD,
      isMock: true,
      isOverMoisture3Days: false,
      observedAt: null,
    };
  }

  const [{ data: weatherRows }, { data: soilRows }] = await Promise.all([
    supabase
      .from('weather_observations')
      .select('*')
      .eq('farm_id', farmId)
      .order('observed_at', { ascending: false })
      .limit(400),
    supabase
      .from('soil_observations')
      .select('moisture_percent, observed_at')
      .order('observed_at', { ascending: false })
      .limit(20),
  ]);

  const weather = weatherRows?.[0] || null;
  const soil = soilRows?.[0] || null;
  if (!weather && !soil) {
    return {
      sensors: MOCK_CLIMATE_SENSORS,
      gdd: MOCK_CLIMATE_GDD,
      isMock: true,
      isOverMoisture3Days: false,
      observedAt: null,
    };
  }

  const gdd = cumulativeGddFromWeather(weatherRows);
  return {
    sensors: rowsToSensors(weather, soil),
    gdd,
    isMock: false,
    isOverMoisture3Days: isHighMoistureThreeDays(soilRows),
    observedAt: weather?.observed_at || soil?.observed_at || null,
  };
}
