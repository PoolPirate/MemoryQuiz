export const LOCATION_RADII_KM = [1000, 750, 500, 250, 100, 50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3];

export function getAllowedRadiusKm(streak: number): number {
  return LOCATION_RADII_KM[Math.min(streak, LOCATION_RADII_KM.length - 1)];
}

export function haversineKm(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number }
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRad(second.lat - first.lat);
  const deltaLng = toRad(second.lng - first.lng);
  const lat1 = toRad(first.lat);
  const lat2 = toRad(second.lat);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function clampTimelinePosition(position: number): number {
  return Math.min(0.98, Math.max(0.02, position));
}

export function getTimelineTimePosition(
  captureTs: number,
  rangeStartTs: number,
  rangeEndTs: number
): number {
  if (rangeEndTs <= rangeStartTs) {
    return 0.5;
  }

  return clampTimelinePosition((captureTs - rangeStartTs) / (rangeEndTs - rangeStartTs));
}
