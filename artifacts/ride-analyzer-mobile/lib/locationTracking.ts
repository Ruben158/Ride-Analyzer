import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const LOCATION_TASK_NAME = 'background-location-task';

const ACTIVE_SESSION_KEY = 'ride-analyzer:active-session';
const RIDES_KEY = 'ride-analyzer:rides';

export type LocationPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number | null;
};

export type ActiveSession = {
  id: string;
  startedAt: number;
  points: LocationPoint[];
};

export type RideSummary = {
  id: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  distanceMeters: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  points: LocationPoint[];
};

function haversineMeters(a: LocationPoint, b: LocationPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function getActiveSessionRaw(): Promise<ActiveSession | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
  return raw ? (JSON.parse(raw) as ActiveSession) : null;
}

async function saveActiveSessionRaw(session: ActiveSession | null): Promise<void> {
  if (session) {
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
  } else {
    await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

// Background task: runs even when the app is backgrounded or the screen is locked.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }
  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const session = await getActiveSessionRaw();
  if (!session) return;

  const newPoints: LocationPoint[] = locations.map((loc) => ({
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    timestamp: loc.timestamp,
    speed: loc.coords.speed,
  }));

  session.points.push(...newPoints);
  await saveActiveSessionRaw(session);
});

export async function requestLocationPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

export async function startRideTracking(): Promise<ActiveSession> {
  const hasPermission = await requestLocationPermissions();
  if (!hasPermission) {
    throw new Error('Location permission not granted');
  }

  const session: ActiveSession = {
    id: `ride-${Date.now()}`,
    startedAt: Date.now(),
    points: [],
  };
  await saveActiveSessionRaw(session);

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 5000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Ride Analyzer',
      notificationBody: 'Tracking your ride in the background',
    },
    pausesUpdatesAutomatically: false,
  });

  return session;
}

export async function stopRideTracking(): Promise<RideSummary | null> {
  const isRunning = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }

  const session = await getActiveSessionRaw();
  await saveActiveSessionRaw(null);

  if (!session || session.points.length === 0) return null;

  const summary = buildSummary(session);

  const existingRaw = await AsyncStorage.getItem(RIDES_KEY);
  const existing: RideSummary[] = existingRaw ? JSON.parse(existingRaw) : [];
  existing.unshift(summary);
  await AsyncStorage.setItem(RIDES_KEY, JSON.stringify(existing));

  return summary;
}

function buildSummary(session: ActiveSession): RideSummary {
  const points = session.points;
  let distanceMeters = 0;
  let maxSpeedMps = 0;
  let speedSum = 0;
  let speedCount = 0;

  for (let i = 1; i < points.length; i++) {
    distanceMeters += haversineMeters(points[i - 1], points[i]);
  }
  for (const p of points) {
    if (p.speed != null && p.speed >= 0) {
      speedSum += p.speed;
      speedCount += 1;
      if (p.speed > maxSpeedMps) maxSpeedMps = p.speed;
    }
  }

  const endedAt = points[points.length - 1]?.timestamp ?? Date.now();
  const durationSeconds = Math.max(0, Math.round((endedAt - session.startedAt) / 1000));

  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds,
    distanceMeters,
    avgSpeedMps: speedCount > 0 ? speedSum / speedCount : 0,
    maxSpeedMps,
    points,
  };
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  return getActiveSessionRaw();
}

export async function getLiveStats(): Promise<RideSummary | null> {
  const session = await getActiveSessionRaw();
  if (!session || session.points.length === 0) return null;
  return buildSummary(session);
}

export async function getRides(): Promise<RideSummary[]> {
  const raw = await AsyncStorage.getItem(RIDES_KEY);
  return raw ? (JSON.parse(raw) as RideSummary[]) : [];
}
