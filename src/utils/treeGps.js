export function parseTreeGps(latitude, longitude) {
  if (latitude === '' || longitude === '') {
    return { error: 'GPS latitude and longitude are required for each tree.' };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return { error: 'Enter valid numeric GPS coordinates.' };
  }
  if (lat < -90 || lat > 90) {
    return { error: 'Latitude must be between -90 and 90.' };
  }
  if (lng < -180 || lng > 180) {
    return { error: 'Longitude must be between -180 and 180.' };
  }

  return { latitude: lat, longitude: lng };
}
