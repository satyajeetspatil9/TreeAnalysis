/** Same live feed as FarmClimateGUI (https://farm-climate-gui.web.app/). */
export const FARM_CLIMATE_STATUS_URL = 'https://futrpixyccnpdmbvahyf.supabase.co/functions/v1/GetFarmStatus';
export const FARM_CLIMATE_FARM_ID = 'TEST_FARM_001';

const FARM_CLIMATE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dHJwaXh5Y2NucGRtYnZhaHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MDc0MjAsImV4cCI6MjA4MTI4MzQyMH0.Ovg9bLums541DrNm7dBC3RPt5XsuQE15qoA0qYipnfE';

export async function fetchFarmStatus(farmId = FARM_CLIMATE_FARM_ID, crop = 'Mango') {
  try {
    const response = await fetch(FARM_CLIMATE_STATUS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FARM_CLIMATE_ANON_KEY}`,
        apikey: FARM_CLIMATE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ farm_id: farmId, crop }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export function readingFromStatus(result) {
  if (!result || typeof result !== 'object') return null;
  return result.last_reading
    || result.lastReading
    || result.sensors
    || result.data?.last_reading
    || null;
}
