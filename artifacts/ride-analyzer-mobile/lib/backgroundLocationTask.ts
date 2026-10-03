import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const LOCATION_TASK = 'ride-analyzer-background-location';
export const ACTIVE_SESSION_KEY = 'ride-analyzer-mobile-active-v1';

type WaitingPeriod = {
  startAt: string;
  endAt: string;
  durationSeconds: number;
};

type FuelEntry = {
  id: string;
  at: string;
  litres: number;
  pricePerLitre: number | null;
};

type PositionSnapshot = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

type ActiveRide = {
  id: string;
  name: string;
  startAt: string;
  distanceMetres: number;
  topSpeedKmh: number;
  lastSpeedKmh: number;
  lastPosition: PositionSnapshot | null;
  locationSamples?: number;
  waitingPeriods: WaitingPeriod[];
  activeWaitSince: string | null;
  fuelEntries: FuelEntry[];
  savedAt: number;
};

const readJson = async <T,>(key: string, fallback: T): Promise<T> => {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const saveActiveRide = async (ride: ActiveRide) => {
  await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(ride));
};

const haversineMetres = (
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLatitude = radians(latitude2 - latitude1);
  const dLongitude = radians(longitude2 - longitude1);
  const value =
    Math.sin(dLatitude / 2) ** 2 +
    Math.cos(radians(latitude1)) *
      Math.cos(radians(latitude2)) *
      Math.sin(dLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const secondsBetween = (start: string, end: string) =>
  Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
    LOCATION_TASK,
    async ({ data, error }) => {
      if (error) {
        console.warn('Ride location task failed:', error.message);
        return;
      }

      try {
      const locations = (data?.locations ?? []).filter(
        (l) => l && l.coords && Number.isFinite(l.coords.latitude) && Number.isFinite(l.coords.longitude),
      );
      if (locations.length === 0) return;
      const activeRide = await readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, null);
      if (!activeRide) return;
      activeRide.distanceMetres = Number(activeRide.distanceMetres) || 0;
      activeRide.topSpeedKmh = Number(activeRide.topSpeedKmh) || 0;
      activeRide.lastSpeedKmh = Number(activeRide.lastSpeedKmh) || 0;
      activeRide.waitingPeriods = Array.isArray(activeRide.waitingPeriods) ? activeRide.waitingPeriods : [];
      activeRide.fuelEntries = Array.isArray(activeRide.fuelEntries) ? activeRide.fuelEntries : [];

      for (const location of locations) {
        const timestamp = new Date(location.timestamp).toISOString();
        const previous = activeRide.lastPosition;
        let distanceDelta = 0;
        let derivedSpeed: number | null = null;
        if (previous) {
          distanceDelta = haversineMetres(
            previous.latitude,
            previous.longitude,
            location.coords.latitude,
            location.coords.longitude,
          );
          const elapsedSeconds = (location.timestamp - previous.timestamp) / 1000;
          if (distanceDelta < 500) {
            activeRide.distanceMetres += Math.max(0, distanceDelta);
            if (elapsedSeconds > 0.5) {
              derivedSpeed = (distanceDelta / elapsedSeconds) * 3.6;
            }
          } else {
            distanceDelta = 0;
          }
        }

        const reportedSpeed = location.coords.speed;
        const speedKmh =
          reportedSpeed !== null && Number.isFinite(reportedSpeed) && reportedSpeed >= 0
            ? reportedSpeed * 3.6
            : derivedSpeed ?? activeRide.lastSpeedKmh;
        activeRide.lastSpeedKmh = Number.isFinite(speedKmh) ? Math.max(0, Math.min(speedKmh, 400)) : 0;
        activeRide.topSpeedKmh = Math.max(activeRide.topSpeedKmh, activeRide.lastSpeedKmh);
        activeRide.locationSamples = (activeRide.locationSamples ?? 0) + 1;

        if (activeRide.lastSpeedKmh <= 3 && !activeRide.activeWaitSince) {
          activeRide.activeWaitSince = timestamp;
        } else if (activeRide.lastSpeedKmh >= 5 && activeRide.activeWaitSince) {
          activeRide.waitingPeriods.push({
            startAt: activeRide.activeWaitSince,
            endAt: timestamp,
            durationSeconds: secondsBetween(activeRide.activeWaitSince, timestamp),
          });
          activeRide.activeWaitSince = null;
        }

        activeRide.lastPosition = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: location.timestamp,
        };
        activeRide.savedAt = Date.now();
      }

      // Only save if the ride wasn't finished while we were processing.
      const stillActive = await readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, null);
      if (stillActive && stillActive.id === activeRide.id) {
        activeRide.fuelEntries = stillActive.fuelEntries ?? activeRide.fuelEntries;
        await saveActiveRide(activeRide);
      }
      } catch (taskError) {
        console.warn('Ride location task error:', taskError);
      }
    },
  );
}