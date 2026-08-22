export function formatGeolocationError(err) {
  if (!err) return 'Could not get GPS location.';

  const code = typeof err === 'object' ? err.code : undefined;
  const message = typeof err === 'object' ? err.message : String(err);

  if (code === 1 || /denied|permission/i.test(message)) {
    return 'Location access was blocked. In browser site settings, allow Location for this site, then tap "Use my current location".';
  }
  if (code === 2) {
    return 'GPS signal not available. Move outdoors or enter coordinates manually.';
  }
  if (code === 3 || /timeout/i.test(message)) {
    return 'Getting GPS timed out. Try again outdoors or enter coordinates manually.';
  }

  return message || 'Could not get GPS location.';
}

export function captureDeviceGps(options = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ error: 'Geolocation is not supported in this browser.' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        error: null,
      }),
      (err) => resolve({ error: formatGeolocationError(err), code: err.code }),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 120000,
        ...options,
      },
    );
  });
}

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
