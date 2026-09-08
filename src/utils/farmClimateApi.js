import { calculateDailyGDD } from './farmClimateLogic';

/** Konkan mango GDD year starts 1 September. Before that date, use last 1 September. */
export function defaultGddSeasonStart(fromDate = new Date()) {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const seasonYear = month >= 8 ? year : year - 1;
  return `${seasonYear}-09-01`;
}

export async function fetchOpenMeteoCurrent(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'shortwave_radiation',
    ].join(','),
    wind_speed_unit: 'kmh',
    timezone: 'Asia/Kolkata',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchOpenMeteoForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'wind_speed_10m_max',
    ].join(','),
    forecast_days: '7',
    wind_speed_unit: 'kmh',
    timezone: 'Asia/Kolkata',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchOpenMeteoArchive(latitude, longitude, startDate, endDate) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'Asia/Kolkata',
  });
  const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`);
  if (!response.ok) return null;
  return response.json();
}

export function gddFromDailySeries(daily) {
  if (!daily?.time?.length) return 0;
  let total = 0;
  daily.time.forEach((_, i) => {
    const tmax = Number(daily.temperature_2m_max?.[i]);
    const tmin = Number(daily.temperature_2m_min?.[i]);
    if (!Number.isFinite(tmax) || !Number.isFinite(tmin)) return;
    total += calculateDailyGDD(tmax, tmin);
  });
  return total;
}

export function forecastDaysFromDaily(daily) {
  if (!daily?.time?.length) return [];
  return daily.time.map((date, i) => ({
    date,
    tmax: daily.temperature_2m_max?.[i] ?? null,
    tmin: daily.temperature_2m_min?.[i] ?? null,
    rain: daily.precipitation_sum?.[i] ?? null,
    wind: daily.wind_speed_10m_max?.[i] ?? null,
  }));
}
