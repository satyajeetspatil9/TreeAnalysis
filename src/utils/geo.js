/** GeoJSON helpers for lot plot boundaries (WGS84). */

export function cornersToPolygon(corners) {
  if (!Array.isArray(corners) || corners.length < 3) {
    throw new Error('Plot boundary needs at least 3 corner coordinates.');
  }

  const ring = corners.map((corner) => {
    const latitude = Number(corner.latitude);
    const longitude = Number(corner.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('Each corner must have valid latitude and longitude.');
    }
    return [longitude, latitude];
  });

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  return { type: 'Polygon', coordinates: [ring] };
}

export function polygonToCorners(polygon) {
  if (!polygon?.coordinates?.[0]?.length) return [];
  const ring = polygon.coordinates[0];
  const openRing = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;

  return openRing.map(([longitude, latitude]) => ({ latitude, longitude }));
}

export function getPolygonBbox(polygon) {
  const ring = polygon?.coordinates?.[0] || [];
  if (!ring.length) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  ring.forEach(([longitude, latitude]) => {
    minLat = Math.min(minLat, latitude);
    maxLat = Math.max(maxLat, latitude);
    minLng = Math.min(minLng, longitude);
    maxLng = Math.max(maxLng, longitude);
  });

  return { minLat, maxLat, minLng, maxLng };
}

export function pointInPolygon(latitude, longitude, polygon) {
  const ring = polygon?.coordinates?.[0];
  if (!ring?.length) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / (yj - yi + 0.0) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function samplePointsInPolygon(polygon, gridSize = 4) {
  const bbox = getPolygonBbox(polygon);
  if (!bbox) return [];

  const points = [];
  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const latitude = bbox.minLat + ((bbox.maxLat - bbox.minLat) * (row + 0.5)) / gridSize;
      const longitude = bbox.minLng + ((bbox.maxLng - bbox.minLng) * (col + 0.5)) / gridSize;
      if (pointInPolygon(latitude, longitude, polygon)) {
        points.push({ latitude, longitude });
      }
    }
  }

  if (!points.length) {
    const centroid = polygonCentroid(polygon);
    if (centroid) points.push(centroid);
  }

  return points;
}

export function polygonCentroid(polygon) {
  const ring = polygon?.coordinates?.[0];
  if (!ring?.length) return null;

  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  ring.forEach(([longitude, latitude], index) => {
    if (index === ring.length - 1
      && ring[0][0] === longitude
      && ring[0][1] === latitude) {
      return;
    }
    sumLat += latitude;
    sumLng += longitude;
    count += 1;
  });

  if (!count) return null;
  return { latitude: sumLat / count, longitude: sumLng / count };
}

/** ~10 m grid inside polygon (GEE reduceRegion scale: 10) */
export function samplePointsInPolygonAtSpacing(polygon, spacingMeters = 10, maxPoints = 100) {
  const bbox = getPolygonBbox(polygon);
  if (!bbox) return [];

  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const meterToLat = 1 / 111320;
  const meterToLng = 1 / (111320 * Math.cos((centerLat * Math.PI) / 180));
  let stepLat = spacingMeters * meterToLat;
  let stepLng = spacingMeters * meterToLng;

  const collectPoints = (latStep, lngStep) => {
    const points = [];
    for (let lat = bbox.minLat + latStep / 2; lat <= bbox.maxLat + 1e-12; lat += latStep) {
      for (let lng = bbox.minLng + lngStep / 2; lng <= bbox.maxLng + 1e-12; lng += lngStep) {
        if (pointInPolygon(lat, lng, polygon)) {
          points.push({ latitude: lat, longitude: lng });
        }
      }
    }
    return points;
  };

  let points = collectPoints(stepLat, stepLng);
  while (points.length > maxPoints && spacingMeters < 80) {
    spacingMeters = Math.round(spacingMeters * 1.5);
    stepLat = spacingMeters * meterToLat;
    stepLng = spacingMeters * meterToLng;
    points = collectPoints(stepLat, stepLng);
  }

  if (!points.length) {
    const centroid = polygonCentroid(polygon);
    if (centroid) points.push(centroid);
  }

  return points;
}

export function distanceApproxMeters(lat1, lng1, lat2, lng2) {
  const meterToLat = 1 / 111320;
  const meterToLng = 1 / (111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)));
  const dLat = (lat2 - lat1) / meterToLat;
  const dLng = (lng2 - lng1) / meterToLng;
  return Math.sqrt((dLat * dLat) + (dLng * dLng));
}

export function parseLotBoundary(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return parseLotBoundary(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (raw.type === 'Polygon' && Array.isArray(raw.coordinates)) {
    return raw;
  }
  if (Array.isArray(raw.corners)) {
    try {
      return cornersToPolygon(raw.corners);
    } catch {
      return null;
    }
  }
  return null;
}
