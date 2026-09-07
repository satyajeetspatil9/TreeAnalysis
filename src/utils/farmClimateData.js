import { calculateDailyGDD } from './farmClimateLogic';
import {
  defaultGddSeasonStart,
  fetchOpenMeteoArchive,
  fetchOpenMeteoCurrent,
  fetchOpenMeteoForecast,
  forecastDaysFromDaily,
  gddFromDailySeries,
} from './farmClimateApi';
import { getTreeGps } from './schema';

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function dailyGddFromSensors(sensors) {
  const air = Number(sensors?.Air_Temperature);
  if (!Number.isFinite(air)) return '0.0';
  return calculateDailyGDD(air + 5, air - 5).toFixed(1);
}

export function farmGpsFromSources(farm, trees = []) {
  const farmLat = num(farm?.latitude);
  const farmLng = num(farm?.longitude);
  if (farmLat != null && farmLng != null) {
    return { latitude: farmLat, longitude: farmLng, source: 'farm' };
  }
  const coords = (trees || []).map(getTreeGps).filter(Boolean);
  if (!coords.length) return null;
  const latitude = coords.reduce((sum, c) => sum + c.latitude, 0) / coords.length;
  const longitude = coords.reduce((sum, c) => sum + c.longitude, 0) / coords.length;
  return { latitude, longitude, source: 'trees' };
}

function sensorsFromWeather(weather) {
  if (!weather) return {};
  return {
    Air_Temperature: num(weather.temperature_c),
    Humidity: num(weather.humidity_percent),
    Rain_mm: num(weather.rainfall_mm),
    Wind_speed: num(weather.wind_speed_kph),
    Wind_direction: num(weather.wind_direction_deg),
    Lux: num(weather.solar_radiation_wm2) != null
      ? Math.round(num(weather.solar_radiation_wm2) * 120)
      : null,
  };
}

function sensorsFromReading(reading) {
  if (!reading) return {};
  return {
    Soil_Moisture: num(reading.moisture_percent),
    Soil_Temperature: num(reading.temperature_c),
    Air_Temperature: num(reading.temperature_c),
  };
}

function sensorsFromMeteo(current) {
  if (!current) return {};
  const rh = num(current.relative_humidity_2m);
  const rain = num(current.precipitation);
  const radiation = num(current.shortwave_radiation);
  return {
    Air_Temperature: num(current.temperature_2m),
    Humidity: rh,
    Rain_mm: rain,
    Wind_speed: num(current.wind_speed_10m),
    Wind_direction: num(current.wind_direction_10m),
    Lux: radiation != null ? Math.round(radiation * 120) : null,
    Leaf_wetness: rh != null && rh >= 90 ? 6 : (rain > 0 ? 4 : 0),
  };
}

function mergeSensors(...parts) {
  const merged = {
    Air_Temperature: null,
    Humidity: null,
    Soil_Moisture: null,
    Leaf_wetness: null,
    Lux: null,
    Rain_mm: null,
    Wind_speed: null,
    Wind_direction: null,
    Soil_Temperature: null,
  };
  parts.forEach((part) => {
    Object.keys(merged).forEach((key) => {
      if (part[key] != null && merged[key] == null) merged[key] = part[key];
    });
  });
  Object.keys(merged).forEach((key) => {
    if (merged[key] == null) merged[key] = 0;
  });
  return merged;
}

function gddFromWeatherRows(rows, seasonStart) {
  const byDay = new Map();
  (rows || []).forEach((row) => {
    const day = String(row.observed_at || '').slice(0, 10);
    const temp = num(row.temperature_c);
    if (!day || day < seasonStart || temp == null) return;
    if (!byDay.has(day)) byDay.set(day, temp);
  });
  let total = 0;
  byDay.forEach((temp) => {
    total += calculateDailyGDD(temp, temp);
  });
  return total;
}

function highMoistureThreeDays(soilRows) {
  const days = [];
  const seen = new Set();
  (soilRows || []).forEach((row) => {
    const day = String(row.observed_at || '').slice(0, 10);
    const moisture = num(row.moisture_percent);
    if (!day || moisture == null || seen.has(day)) return;
    seen.add(day);
    days.push(moisture);
  });
  return days.slice(0, 3).length >= 3 && days.slice(0, 3).every((m) => m > 75);
}

export async function loadFarmClimateSnapshot(supabase, farm, trees = [], crop = 'Mango') {
  const gps = farmGpsFromSources(farm, trees);
  const seasonStart = farm?.gdd_season_start || defaultGddSeasonStart();
  const today = new Date().toISOString().slice(0, 10);

  const weatherQuery = farm?.id
    ? supabase
      .from('weather_observations')
      .select('*')
      .eq('farm_id', farm.id)
      .order('observed_at', { ascending: false })
      .limit(400)
    : Promise.resolve({ data: [] });

  const soilQuery = supabase
    .from('soil_observations')
    .select('moisture_percent, observed_at, temperature_c')
    .order('observed_at', { ascending: false })
    .limit(20);

  const sensorQuery = farm?.id
    ? supabase
      .from('sensors')
      .select('id')
      .eq('farm_id', farm.id)
    : Promise.resolve({ data: [] });

  const [{ data: weatherRows }, { data: soilRows }, { data: sensors }] = await Promise.all([
    weatherQuery,
    soilQuery,
    sensorQuery,
  ]);

  let latestReading = null;
  const sensorIds = (sensors || []).map((row) => row.id);
  if (sensorIds.length) {
    const { data: readings } = await supabase
      .from('sensor_readings')
      .select('*')
      .in('sensor_id', sensorIds)
      .order('recorded_at', { ascending: false })
      .limit(1);
    latestReading = readings?.[0] || null;
  }

  let meteoCurrent = null;
  let forecast = [];
  let archiveGdd = 0;
  let meteoError = null;

  if (gps) {
    try {
      const [currentPayload, forecastPayload, archivePayload] = await Promise.all([
        fetchOpenMeteoCurrent(gps.latitude, gps.longitude),
        fetchOpenMeteoForecast(gps.latitude, gps.longitude),
        fetchOpenMeteoArchive(gps.latitude, gps.longitude, seasonStart, today),
      ]);
      meteoCurrent = currentPayload?.current || null;
      forecast = forecastDaysFromDaily(forecastPayload?.daily);
      archiveGdd = gddFromDailySeries(archivePayload?.daily);
    } catch (err) {
      meteoError = err.message;
    }
  }

  const weather = weatherRows?.[0] || null;
  const soil = soilRows?.[0] || null;
  const merged = mergeSensors(
    sensorsFromWeather(weather),
    sensorsFromReading(latestReading),
    {
      Soil_Moisture: num(soil?.moisture_percent),
      Soil_Temperature: num(soil?.temperature_c),
    },
    sensorsFromMeteo(meteoCurrent),
  );

  const loggedGdd = gddFromWeatherRows(weatherRows, seasonStart);
  const gdd = archiveGdd > 0 ? archiveGdd : loggedGdd;
  const hasLocal = Boolean(weather || soil || latestReading);
  const hasMeteo = Boolean(meteoCurrent);

  return {
    sensors: merged,
    gdd,
    isMock: !hasLocal && !hasMeteo,
    isOverMoisture3Days: highMoistureThreeDays(soilRows),
    farmId: farm?.id || null,
    gps,
    seasonStart,
    forecast,
    source: hasLocal && hasMeteo
      ? 'Farm logs + Open-Meteo'
      : hasLocal
        ? 'Farm weather / soil logs'
        : hasMeteo
          ? 'Open-Meteo at orchard GPS'
          : 'No GPS or weather yet',
    meteoError,
    observedAt: weather?.observed_at || latestReading?.recorded_at || meteoCurrent?.time || null,
    crop,
  };
}
