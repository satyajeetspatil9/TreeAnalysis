import { calculateDailyGDD } from './farmClimateLogic';
import { FARM_CLIMATE_FARM_ID, fetchFarmStatus, readingFromStatus } from './farmClimateApi';

/** Demo sensors from FarmClimateGUI when GetFarmStatus is unreachable. */
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

export function dailyGddFromSensors(sensors) {
  const air = Number(sensors?.Air_Temperature);
  if (!Number.isFinite(air)) return '0.0';
  return calculateDailyGDD(air + 5, air - 5).toFixed(1);
}

export async function loadFarmClimateSnapshot(crop = 'Mango') {
  const result = await fetchFarmStatus(FARM_CLIMATE_FARM_ID, crop);
  const sensors = readingFromStatus(result);
  if (sensors) {
    return {
      sensors,
      gdd: Number(result.gdd_stats?.cumulative_gdd) || 0,
      isMock: false,
      isOverMoisture3Days: Boolean(result.isOverMoisture3Days),
      farmId: result.farm_id || FARM_CLIMATE_FARM_ID,
      observedAt: sensors.timestamp || sensors.recorded_at || result.updated_at || null,
    };
  }

  return {
    sensors: MOCK_CLIMATE_SENSORS,
    gdd: MOCK_CLIMATE_GDD,
    isMock: true,
    isOverMoisture3Days: false,
    farmId: FARM_CLIMATE_FARM_ID,
    observedAt: null,
  };
}
