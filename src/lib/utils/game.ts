export const LOCATION_RADII_KM = [2000, 1000, 500, 250, 100, 50, 25];

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

export function getDateGapThresholdDays(streak: number): number {
  const thresholds = [365 * 4, 365 * 2, 365, 180, 90, 30, 7];
  return thresholds[Math.min(streak, thresholds.length - 1)];
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

export function formatFriendlyDate(iso?: string | null): string {
  if (!iso) {
    return 'Never';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(iso));
}
