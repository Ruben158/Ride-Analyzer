import type * as Location from 'expo-location';

export const LOCATION_TASK = 'ride-analyzer-background-location';
export const ACTIVE_SESSION_KEY = 'ride-analyzer-mobile-active-v1';
export const MAX_PLAUSIBLE_SPEED_KMH = 220;

export type WaitingPeriod = {
  startAt: string;
  endAt: string;
  durationSeconds: number;
};

export type FuelEntry = {
  id: string;
  at: string;
  litres: number;
  pricePerLitre: number | null;
};

export type PositionSnapshot = {
  latitude: number;
  longitude: number;
  timestamp: number;
  wallTime?: number;
  accuracy?: number;
};

export type ActiveRide = {
  id: string;
  name: string;
  startAt: string;
  distanceMetres: number;
  topSpeedKmh: number;
  lastSpeedKmh: number;
  lastPosition: PositionSnapshot | null;
  lastMovementAt?: number;
  locationSamples?: number;
  waitingPeriods: WaitingPeriod[];
  activeWaitSince: string | null;
  fuelEntries: FuelEntry[];
  savedAt: number;
};

export const haversineMetres = (
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
) => {
  if (
    !Number.isFinite(latitude1) ||
    !Number.isFinite(longitude1) ||
    !Number.isFinite(latitude2) ||
    !Number.isFinite(longitude2)
  ) {
    return 0;
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLatitude = radians(latitude2 - latitude1);
  const dLongitude = radians(longitude2 - longitude1);
  const value =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(radians(latitude1)) *
      Math.cos(radians(latitude2)) *
      Math.sin(dLongitude / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, value));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
};

const secondsBetween = (start: string, end: string) => {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
};

export function applyLocationUpdateToRide(
  activeRide: ActiveRide,
  location: Location.LocationObject,
): ActiveRide {
  if (!location || !location.coords) return activeRide;
  const { latitude, longitude, accuracy: rawAccuracy, speed: rawSpeed } = location.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return activeRide;

  const nowWall = Date.now();
  const locTimestamp =
    Number.isFinite(location.timestamp) && location.timestamp > 0
      ? location.timestamp
      : nowWall;
  const accuracy =
    rawAccuracy !== null && Number.isFinite(rawAccuracy) && rawAccuracy > 0
      ? rawAccuracy
      : 20;

  activeRide.distanceMetres = Number(activeRide.distanceMetres) || 0;
  activeRide.topSpeedKmh = Number(activeRide.topSpeedKmh) || 0;
  activeRide.lastSpeedKmh = Number(activeRide.lastSpeedKmh) || 0;
  activeRide.waitingPeriods = Array.isArray(activeRide.waitingPeriods)
    ? activeRide.waitingPeriods
    : [];
  activeRide.fuelEntries = Array.isArray(activeRide.fuelEntries)
    ? activeRide.fuelEntries
    : [];

  const previous = activeRide.lastPosition;
  if (previous && accuracy > 150) {
    return activeRide;
  }

  if (
    previous &&
    Math.abs(locTimestamp - previous.timestamp) < 250 &&
    haversineMetres(previous.latitude, previous.longitude, latitude, longitude) < 1
  ) {
    return activeRide;
  }

  const reportedSpeedKmh =
    rawSpeed !== null &&
    Number.isFinite(rawSpeed) &&
    rawSpeed >= 0 &&
    rawSpeed * 3.6 <= MAX_PLAUSIBLE_SPEED_KMH
      ? rawSpeed * 3.6
      : null;

  let computedSpeedKmh: number = reportedSpeedKmh ?? 0;

  if (previous) {
    const distanceDelta = haversineMetres(
      previous.latitude,
      previous.longitude,
      latitude,
      longitude,
    );
    const rawElapsed = (locTimestamp - previous.timestamp) / 1000;
    const wallElapsed = previous.wallTime ? (nowWall - previous.wallTime) / 1000 : rawElapsed;
    const elapsedSeconds =
      Number.isFinite(rawElapsed) && rawElapsed > 0 && rawElapsed < 36000
        ? rawElapsed
        : Math.max(0, wallElapsed);

    const combinedAccuracy = Math.max(accuracy, previous.accuracy ?? 20);
    const minMoveMetres = Math.max(3, Math.min(combinedAccuracy * 0.35, 12));
    const isLikelyJitter =
      distanceDelta < minMoveMetres ||
      (reportedSpeedKmh !== null &&
        reportedSpeedKmh < 1.5 &&
        distanceDelta < Math.max(8, combinedAccuracy * 0.6));

    if (!isLikelyJitter && elapsedSeconds > 0.2) {
      const impliedSpeedKmh = (distanceDelta / elapsedSeconds) * 3.6;
      if (impliedSpeedKmh <= MAX_PLAUSIBLE_SPEED_KMH) {
        activeRide.distanceMetres += Math.max(0, distanceDelta);
        activeRide.lastMovementAt = nowWall;
        if (reportedSpeedKmh === null && elapsedSeconds >= 0.8) {
          computedSpeedKmh = Math.max(0, impliedSpeedKmh);
        }
      }
    } else if (isLikelyJitter) {
      if (reportedSpeedKmh === null || reportedSpeedKmh < 1.5) {
        computedSpeedKmh = 0;
      }
    }
  } else {
    activeRide.lastMovementAt = nowWall;
  }

  if (computedSpeedKmh >= 3) {
    activeRide.lastMovementAt = nowWall;
  }

  activeRide.lastSpeedKmh = Number.isFinite(computedSpeedKmh)
    ? Math.max(0, Math.min(computedSpeedKmh, MAX_PLAUSIBLE_SPEED_KMH))
    : 0;
  activeRide.topSpeedKmh = Math.max(activeRide.topSpeedKmh, activeRide.lastSpeedKmh);
  activeRide.locationSamples = (activeRide.locationSamples ?? 0) + 1;

  const isoTimestamp = new Date(locTimestamp).toISOString();
  if (activeRide.lastSpeedKmh <= 3 && !activeRide.activeWaitSince) {
    activeRide.activeWaitSince = isoTimestamp;
  } else if (activeRide.lastSpeedKmh >= 5 && activeRide.activeWaitSince) {
    const durationSeconds = secondsBetween(activeRide.activeWaitSince, isoTimestamp);
    if (durationSeconds >= 1) {
      activeRide.waitingPeriods.push({
        startAt: activeRide.activeWaitSince,
        endAt: isoTimestamp,
        durationSeconds,
      });
    }
    activeRide.activeWaitSince = null;
  }

  activeRide.lastPosition = {
    latitude,
    longitude,
    timestamp: locTimestamp,
    wallTime: nowWall,
    accuracy,
  };
  activeRide.savedAt = nowWall;
  return activeRide;
}
