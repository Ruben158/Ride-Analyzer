import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  type ActiveSession,
  type RideSummary,
  getActiveSession,
  getLiveStats,
  getRides,
  requestLocationPermissions,
  startRideTracking,
  stopRideTracking,
} from '@/lib/locationTracking';

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

function formatSpeed(mps: number): string {
  const kmh = mps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export default function RideScreen() {
  const colors = useColors();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [live, setLive] = useState<RideSummary | null>(null);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRides = useCallback(async () => {
    const list = await getRides();
    setRides(list);
  }, []);

  const refreshLive = useCallback(async () => {
    const stats = await getLiveStats();
    setLive(stats);
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      refreshLive();
    }, 2000);
  }, [refreshLive]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const active = await getActiveSession();
      setSession(active);
      if (active) {
        startPolling();
        refreshLive();
      }
      await refreshRides();
    })();

    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        const active = await getActiveSession();
        setSession(active);
        if (active) {
          refreshLive();
        }
      }
    });

    return () => {
      stopPolling();
      sub.remove();
    };
  }, [refreshRides, refreshLive, startPolling, stopPolling]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) {
        Alert.alert(
          'Permission needed',
          'Ride Analyzer needs background location access to track your ride, even when your phone is locked.'
        );
        setBusy(false);
        return;
      }
      const newSession = await startRideTracking();
      setSession(newSession);
      setLive(null);
      startPolling();
    } catch (err) {
      Alert.alert('Could not start ride', String(err));
    } finally {
      setBusy(false);
    }
  }, [startPolling]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      stopPolling();
      const summary = await stopRideTracking();
      setSession(null);
      setLive(null);
      if (summary) {
        await refreshRides();
      }
    } catch (err) {
      Alert.alert('Could not stop ride', String(err));
    } finally {
      setBusy(false);
    }
  }, [stopPolling, refreshRides]);

  const isTracking = session != null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Ride Analyzer</Text>
      </View>

      <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Duration</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {formatDuration(live?.durationSeconds ?? 0)}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Distance</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {formatDistance(live?.distanceMeters ?? 0)}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Avg speed</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {formatSpeed(live?.avgSpeedMps ?? 0)}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Max speed</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {formatSpeed(live?.maxSpeedMps ?? 0)}
          </Text>
        </View>
      </View>

      <Pressable
        disabled={busy}
        onPress={isTracking ? handleStop : handleStart}
        style={[
          styles.button,
          { backgroundColor: isTracking ? '#dc2626' : '#16a34a', opacity: busy ? 0.6 : 1 },
        ]}
      >
        <Text style={styles.buttonText}>
          {isTracking ? 'Stop Ride' : 'Start Ride'}
        </Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Ride History</Text>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No rides yet. Start your first ride above.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.rideItem, { backgroundColor: colors.card }]}>
            <Text style={[styles.rideDate, { color: colors.text }]}>
              {new Date(item.startedAt).toLocaleString()}
            </Text>
            <View style={styles.rideStatsRow}>
              <Text style={[styles.rideStat, { color: colors.mutedForeground }]}>
                {formatDuration(item.durationSeconds)}
              </Text>
              <Text style={[styles.rideStat, { color: colors.mutedForeground }]}>
                {formatDistance(item.distanceMeters)}
              </Text>
              <Text style={[styles.rideStat, { color: colors.mutedForeground }]}>
                {formatSpeed(item.avgSpeedMps)} avg
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  statsCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  statLabel: {
    fontSize: 14,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 8,
  },
  rideItem: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rideDate: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  rideStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rideStat: {
    fontSize: 13,
  },
});