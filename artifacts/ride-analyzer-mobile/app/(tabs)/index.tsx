import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  ACTIVE_SESSION_KEY,
  LOCATION_TASK,
  type ActiveRide,
  type FuelEntry,
  type WaitingPeriod,
  applyLocationUpdateToRide,
} from '@/lib/backgroundLocationTask';

const RIDE_HISTORY_KEY = 'ride-analyzer-mobile-history-v1';

type Ride = {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  distanceKm: number;
  averageSpeedKmh: number;
  topSpeedKmh: number;
  locationSamples?: number;
  waitingSeconds: number;
  waitingPeriods: WaitingPeriod[];
  fuelEntries: FuelEntry[];
};

const readJson = async <T,>(key: string, fallback: T): Promise<T> => {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};

const saveActiveRide = async (ride: ActiveRide | null) => {
  try {
    if (!ride) {
      await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
      return;
    }
    await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(ride));
  } catch {
    // Ignore storage errors
  }
};

const secondsBetween = (start: string, end: string) => {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
};

const waitingTotal = (periods: WaitingPeriod[]) =>
  (Array.isArray(periods) ? periods : []).reduce(
    (total, period) => total + (Number(period?.durationSeconds) || 0),
    0,
  );

const formatDuration = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m ${String(remainder).padStart(2, '0')}s`;
};

const formatClock = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '--:--';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatRideDate = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const storedWaitSeconds = (ride: ActiveRide, now: number) =>
  waitingTotal(ride.waitingPeriods) +
  (ride.activeWaitSince
    ? Math.max(0, Math.floor((now - new Date(ride.activeWaitSince).getTime()) / 1000))
    : 0);

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RideRecorderScreen() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const styles = makeStyles(colors);
  const [foregroundPermission, requestForegroundPermission] =
    Location.useForegroundPermissions();
  const [backgroundPermission, requestBackgroundPermission] =
    Location.useBackgroundPermissions();
  const [isReady, setIsReady] = useState(false);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [rideName, setRideName] = useState('');
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [fuelDialogOpen, setFuelDialogOpen] = useState(false);
  const [fuelLitres, setFuelLitres] = useState('');
  const [fuelPrice, setFuelPrice] = useState('');

  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const activeRideRef = useRef<ActiveRide | null>(null);

  useEffect(() => {
    activeRideRef.current = activeRide;
  }, [activeRide]);

  const stopForegroundWatcher = () => {
    if (watchSubscriptionRef.current) {
      try {
        watchSubscriptionRef.current.remove();
      } catch {
        // Ignore removal errors
      }
      watchSubscriptionRef.current = null;
    }
  };

  const stopAllTracking = async () => {
    stopForegroundWatcher();
    if (Platform.OS !== 'web') {
      try {
        if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
          await Location.stopLocationUpdatesAsync(LOCATION_TASK);
        }
      } catch {
        // Ignore stop errors
      }
    }
    setBackgroundActive(false);
  };

  const handleForegroundLocation = async (location: Location.LocationObject) => {
    const current =
      (await readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, null)) ??
      activeRideRef.current;
    if (!current) return;
    const updated = applyLocationUpdateToRide({ ...current }, location);
    activeRideRef.current = updated;
    setActiveRide({ ...updated });
    await saveActiveRide(updated);
  };

  const startForegroundWatcher = async () => {
    stopForegroundWatcher();
    try {
      const initial = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await handleForegroundLocation(initial);
    } catch {
      // Initial fix is optional before watchPositionAsync starts
    }

    try {
      watchSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (loc) => {
          void handleForegroundLocation(loc);
        },
      );
    } catch {
      watchSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 2000,
          distanceInterval: 2,
        },
        (loc) => {
          void handleForegroundLocation(loc);
        },
      );
    }
  };

  const tryStartBackgroundService = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    try {
      const taskManagerAvailable = await TaskManager.isAvailableAsync();
      if (!taskManagerAvailable) return false;

      const bgPerm = await Location.getBackgroundPermissionsAsync();
      if (!bgPerm.granted) return false;

      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
        } catch {
          // Non-fatal if notification permission prompt is dismissed
        }
      }

      // Wait until the Activity is fully in the foreground RESUMED state
      // to avoid Android 12+ ForegroundServiceStartNotAllowedException
      await delay(400);
      if (AppState.currentState !== 'active') {
        return false;
      }

      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (!alreadyStarted) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Ride Analyzer is recording',
            notificationBody: 'Ride location tracking is active. Tap to return to your ride.',
            notificationColor: '#F57F4D',
            killServiceOnDestroy: false,
          },
        });
      }
      setBackgroundActive(true);
      return true;
    } catch (bgError) {
      console.warn('Background location service could not start, using foreground GPS:', bgError);
      setBackgroundActive(false);
      return false;
    }
  };

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      const [savedRides, savedActiveRide] = await Promise.all([
        readJson<Ride[]>(RIDE_HISTORY_KEY, []),
        readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, null),
      ]);
      if (!mounted) return;
      const validRides = Array.isArray(savedRides) ? savedRides : [];
      const sortedRides = [...validRides].sort(
        (first, second) =>
          new Date(second.endAt).getTime() - new Date(first.endAt).getTime(),
      );
      setRides(sortedRides);

      if (savedActiveRide && savedActiveRide.startAt) {
        const fgPerm = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (mounted && fgPerm?.granted) {
          setActiveRide(savedActiveRide);
          activeRideRef.current = savedActiveRide;
          await startForegroundWatcher().catch(() => {});
          const bgRunning = await tryStartBackgroundService();
          if (mounted) {
            setNotice(
              bgRunning
                ? 'Your ride is still recording. You can lock your phone safely.'
                : 'Your ride is recording while the app is open.',
            );
          }
        } else {
          await saveActiveRide(null);
        }
      }
      if (mounted) setIsReady(true);
    };
    void hydrate();
    return () => {
      mounted = false;
      stopForegroundWatcher();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && activeRideRef.current) {
        void (async () => {
          if (!watchSubscriptionRef.current) {
            await startForegroundWatcher().catch(() => {});
          }
          await tryStartBackgroundService();
        })();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (activeRide) {
        void readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, null)
          .then(async (updated) => {
            if (!updated || updated.id !== activeRide.id) return;
            const lastMove = updated.lastMovementAt ?? updated.lastPosition?.wallTime ?? 0;
            if (updated.lastSpeedKmh > 0 && lastMove > 0 && currentTime - lastMove >= 4500) {
              updated.lastSpeedKmh = 0;
              if (!updated.activeWaitSince) {
                updated.activeWaitSince = new Date(currentTime).toISOString();
              }
              await saveActiveRide(updated);
            }
            activeRideRef.current = updated;
            setActiveRide(updated);
          })
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activeRide?.id]);

  const showPermissionSettings = (title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => void Linking.openSettings() },
    ]);
  };

  const enableLockScreenTracking = async () => {
    try {
      const bg = await requestBackgroundPermission();
      if (bg.granted) {
        const started = await tryStartBackgroundService();
        if (started) {
          setNotice('Locked-screen recording enabled.');
        }
      } else {
        showPermissionSettings(
          'Allow location all the time',
          'Choose “Allow all the time” in Android Location settings so Ride Analyzer can keep recording when your screen is locked.',
        );
      }
    } catch {
      showPermissionSettings(
        'Allow location all the time',
        'Choose “Allow all the time” in Android Location settings so Ride Analyzer can keep recording when your screen is locked.',
      );
    }
  };

  const startRide = async () => {
    if (!isReady || busy || activeRide) return;

    setBusy(true);
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        Alert.alert(
          'Turn on Location',
          'Enable Location in your device settings before starting a ride.',
        );
        return;
      }

      let foreground = foregroundPermission;
      if (!foreground?.granted) {
        foreground = await requestForegroundPermission();
      }
      if (!foreground?.granted) {
        if (!foreground?.canAskAgain) {
          showPermissionSettings(
            'Location permission needed',
            'Allow location while using the app so Ride Analyzer can measure this ride.',
          );
        } else {
          setNotice('Location permission is needed to start a ride.');
        }
        return;
      }

      const nowMs = Date.now();
      const startedAt = new Date(nowMs).toISOString();
      const session: ActiveRide = {
        id: `${nowMs}-${Math.random().toString(36).slice(2, 9)}`,
        name: rideName.trim() || 'My ride',
        startAt: startedAt,
        distanceMetres: 0,
        topSpeedKmh: 0,
        lastSpeedKmh: 0,
        lastPosition: null,
        lastMovementAt: nowMs,
        locationSamples: 0,
        waitingPeriods: [],
        activeWaitSince: null,
        fuelEntries: [],
        savedAt: nowMs,
      };

      await saveActiveRide(session);
      activeRideRef.current = session;
      setSelectedRide(null);
      setRideName('');
      setActiveRide(session);
      setNow(nowMs);

      await startForegroundWatcher();

      const bgStarted = await tryStartBackgroundService();
      setNotice(
        bgStarted
          ? 'Recording started. Lock your phone; the ride service will keep tracking.'
          : 'Recording started! Keep the app on screen, or tap below to enable locked-screen tracking.',
      );
    } catch (error) {
      await stopAllTracking();
      await saveActiveRide(null).catch(() => {});
      activeRideRef.current = null;
      setActiveRide(null);
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Could not start ride', message);
    } finally {
      setBusy(false);
    }
  };

  const finishRide = async () => {
    if (!activeRide || busy) return;
    setBusy(true);
    try {
      const latest = await readJson<ActiveRide | null>(ACTIVE_SESSION_KEY, activeRide);
      const session = latest ?? activeRide;
      const endedAt = new Date().toISOString();
      const durationSeconds = secondsBetween(session.startAt, endedAt);
      const waitingPeriods = [...(session.waitingPeriods ?? [])];
      if (session.activeWaitSince) {
        waitingPeriods.push({
          startAt: session.activeWaitSince,
          endAt: endedAt,
          durationSeconds: secondsBetween(session.activeWaitSince, endedAt),
        });
      }
      const distanceKm = (Number(session.distanceMetres) || 0) / 1000;
      const ride: Ride = {
        id: session.id,
        name: session.name,
        startAt: session.startAt,
        endAt: endedAt,
        durationSeconds,
        distanceKm,
        averageSpeedKmh:
          durationSeconds > 0 ? distanceKm / (durationSeconds / 3600) : 0,
        topSpeedKmh: Number(session.topSpeedKmh) || 0,
        locationSamples: session.locationSamples ?? 0,
        waitingSeconds: waitingTotal(waitingPeriods),
        waitingPeriods,
        fuelEntries: Array.isArray(session.fuelEntries) ? session.fuelEntries : [],
      };

      await stopAllTracking();
      const updatedRides = [ride, ...rides.filter((item) => item.id !== ride.id)];
      await AsyncStorage.setItem(RIDE_HISTORY_KEY, JSON.stringify(updatedRides));
      await saveActiveRide(null);
      activeRideRef.current = null;
      setRides(updatedRides);
      setActiveRide(null);
      setSelectedRide(ride);
      setNotice('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Could not finish ride', message);
    } finally {
      setBusy(false);
    }
  };

  const confirmFinishRide = () => {
    Alert.alert('Finish this ride?', 'The ride details will be saved to your history.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Finish ride', style: 'default', onPress: () => void finishRide() },
    ]);
  };

  const discardRide = () => {
    Alert.alert('Discard this ride?', 'This ride will not be added to your history.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await stopAllTracking();
              await saveActiveRide(null);
              activeRideRef.current = null;
              setActiveRide(null);
              setNotice('Ride discarded. Start a new ride whenever you are ready.');
            } catch {
              Alert.alert('Could not stop tracking', 'Please try again.');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const addFuel = async () => {
    const litres = Number(fuelLitres);
    const price = fuelPrice.trim() ? Number(fuelPrice) : null;
    if (!activeRide || !Number.isFinite(litres) || litres <= 0) {
      Alert.alert('Enter fuel amount', 'Litres must be greater than zero.');
      return;
    }
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      Alert.alert('Check the price', 'Price per litre must be zero or more.');
      return;
    }
    const entry: FuelEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      litres,
      pricePerLitre: price,
    };
    const updated = {
      ...activeRide,
      fuelEntries: [...(activeRide.fuelEntries ?? []), entry],
    };
    await saveActiveRide(updated);
    activeRideRef.current = updated;
    setActiveRide(updated);
    setFuelLitres('');
    setFuelPrice('');
    setFuelDialogOpen(false);
    setNotice(`${litres.toFixed(2)} L added to this ride.`);
  };

  const renderMetric = (
    icon: React.ComponentProps<typeof Feather>['name'],
    label: string,
    value: string,
  ) => (
    <View style={styles.metricCard} key={label}>
      <View style={styles.metricIcon}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );

  const renderSummary = (ride: Ride) => {
    const fuelLitresTotal = (ride.fuelEntries ?? []).reduce(
      (total, entry) => total + (Number(entry.litres) || 0),
      0,
    );
    const economy = fuelLitresTotal > 0 ? ride.distanceKm / fuelLitresTotal : null;
    return (
      <View style={styles.sectionGap}>
        <View style={styles.summaryHeading}>
          <View style={styles.summaryBadge}>
            <Feather name="check" size={14} color={colors.secondaryForeground} />
            <Text style={styles.summaryBadgeText}>RIDE COMPLETE</Text>
          </View>
          <Pressable
            style={styles.iconButton}
            onPress={() => setSelectedRide(null)}
            accessibilityLabel="Close ride details"
          >
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <Text style={styles.summaryTitle}>{ride.name}</Text>
        <Text style={styles.mutedText}>
          {formatRideDate(ride.startAt)} · {formatClock(ride.startAt)} – {formatClock(ride.endAt)}
        </Text>

        <View style={styles.distanceCard}>
          <Text style={[styles.eyebrow, styles.distanceCardEyebrow]}>DISTANCE TRAVELLED</Text>
          <View style={styles.distanceLine}>
            <Text style={styles.distanceValue}>{num(ride.distanceKm).toFixed(2)}</Text>
            <Text style={styles.distanceUnit}>km</Text>
          </View>
          <Text style={[styles.mutedText, styles.distanceCardSubtext]}>
            Ride duration {formatDuration(ride.durationSeconds)}
          </Text>
        </View>

        {ride.locationSamples === 0 && (
          <View style={styles.gpsWarning}>
            <Feather name="alert-triangle" size={16} color={colors.destructive} />
            <Text style={styles.gpsWarningText}>
              No GPS fixes were received. This ride has no measured distance; check that Location is on and allowed.
            </Text>
          </View>
        )}

        <View style={styles.metricGrid}>
          {renderMetric('activity', 'Average speed', `${num(ride.averageSpeedKmh).toFixed(1)} km/h`)}
          {renderMetric('trending-up', 'Top speed', `${num(ride.topSpeedKmh).toFixed(1)} km/h`)}
          {renderMetric('clock', 'Traffic wait', formatDuration(ride.waitingSeconds))}
          {renderMetric('droplet', 'Fuel added', `${fuelLitresTotal.toFixed(2)} L`)}
          {economy !== null && renderMetric('navigation', 'Fuel economy', `${economy.toFixed(1)} km/L`)}
        </View>

        {(ride.waitingPeriods ?? []).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Waiting intervals</Text>
            <Text style={styles.mutedText}>Estimated from low GPS speed</Text>
            {ride.waitingPeriods.map((period, index) => (
              <View style={styles.timelineRow} key={`${period.startAt}-${index}`}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>
                    Stop {index + 1} · {formatDuration(period.durationSeconds)}
                  </Text>
                  <Text style={styles.mutedText}>
                    {formatClock(period.startAt)} – {formatClock(period.endAt)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {(ride.fuelEntries ?? []).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fuel entries</Text>
            {ride.fuelEntries.map((entry) => (
              <View style={styles.listRow} key={entry.id}>
                <Text style={styles.listMain}>{num(entry.litres).toFixed(2)} L</Text>
                <Text style={styles.mutedText}>{formatClock(entry.at)}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable style={styles.secondaryButton} onPress={() => setSelectedRide(null)}>
          <Text style={styles.secondaryButtonText}>Back to rides</Text>
        </Pressable>
      </View>
    );
  };

  const visibleRides = historyExpanded ? rides : rides.slice(0, 3);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Feather name="activity" size={19} color={colors.primaryForeground} />
            </View>
            <View>
              <Text style={styles.brandName}>Ride Analyzer</Text>
              <Text style={styles.brandCaption}>YOUR TRIP, MEASURED</Text>
            </View>
          </View>
          <Pressable
            style={styles.historyButton}
            onPress={() => setHistoryExpanded((value) => !value)}
          >
            <Feather name="clock" size={15} color={colors.foreground} />
            <Text style={styles.historyButtonText}>History</Text>
          </Pressable>
        </View>

        {selectedRide ? (
          renderSummary(selectedRide)
        ) : activeRide ? (
          <View style={styles.sectionGap}>
            <View style={styles.activeHeader}>
              <View>
                <View style={styles.recordingLabel}>
                  <View style={styles.liveDot} />
                  <Text style={styles.eyebrow}>RECORDING NOW</Text>
                </View>
                <Text style={styles.activeTitle}>{activeRide.name}</Text>
                <Text style={styles.mutedText}>Started {formatClock(activeRide.startAt)}</Text>
              </View>
              <Pressable
                style={styles.iconButton}
                onPress={discardRide}
                accessibilityLabel="Discard ride"
              >
                <Feather name="more-horizontal" size={21} color={colors.foreground} />
              </Pressable>
            </View>

            <View style={styles.distanceCard}>
              <Text style={[styles.eyebrow, styles.distanceCardEyebrow]}>DISTANCE TRAVELLED</Text>
              <View style={styles.distanceLine}>
                <Text style={styles.distanceValue}>
                  {num(activeRide.distanceMetres / 1000).toFixed(2)}
                </Text>
                <Text style={styles.distanceUnit}>km</Text>
              </View>
              <Text style={[styles.mutedText, styles.distanceCardSubtext]}>Live GPS measurement</Text>
            </View>

            <View style={styles.metricGrid}>
              {renderMetric(
                'navigation',
                'Current speed',
                `${num(activeRide.lastSpeedKmh).toFixed(1)} km/h`,
              )}
              {renderMetric(
                'trending-up',
                'Top speed',
                `${num(activeRide.topSpeedKmh).toFixed(1)} km/h`,
              )}
              {renderMetric(
                'clock',
                'Ride time',
                formatDuration(secondsBetween(activeRide.startAt, new Date(now).toISOString())),
              )}
              {renderMetric(
                'pause',
                'Traffic wait',
                formatDuration(storedWaitSeconds(activeRide, now)),
              )}
            </View>

            <View style={styles.backgroundNote}>
              <Feather name="smartphone" size={16} color={colors.primary} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.backgroundNoteText}>
                  {backgroundActive
                    ? 'Screen can be locked. Keep the Ride Analyzer location notification active.'
                    : 'Recording live while the app is on screen.'}
                  {'\n'}
                  {activeRide.lastPosition
                    ? `GPS: ${activeRide.locationSamples ?? 1} fixes · last fix ${formatDuration(Math.max(0, (now - activeRide.lastPosition.timestamp) / 1000))} ago`
                    : 'GPS: waiting for the first fix. Keep Location on and move outdoors.'}
                </Text>
                {!backgroundActive && Platform.OS !== 'web' && (
                  <Pressable onPress={() => void enableLockScreenTracking()}>
                    <Text style={styles.textLink}>Enable locked-screen tracking →</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.secondaryButton, styles.fuelButton]}
                onPress={() => setFuelDialogOpen(true)}
              >
                <Feather name="droplet" size={17} color={colors.foreground} />
                <Text style={styles.secondaryButtonText}>Add fuel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, styles.finishButton, busy && styles.disabledButton]}
                onPress={confirmFinishRide}
                disabled={busy}
              >
                <Feather name="square" size={15} color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Finish ride'}</Text>
              </Pressable>
            </View>
            <Pressable onPress={discardRide} style={styles.discardLink}>
              <Text style={styles.discardText}>Discard ride</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sectionGap}>
            <View style={styles.heroCopy}>
              <View style={styles.heroEyebrowRow}>
                <View style={styles.heroEyebrowDot} />
                <Text style={styles.heroEyebrow}>BEFORE THE DRIVE</Text>
              </View>
              <Text style={styles.heroTitle}>
                Ready when <Text style={styles.heroAccent}>you are.</Text>
              </Text>
              <Text style={styles.heroBody}>
                Start a ride, lock your phone, and get the full trip details when you arrive.
              </Text>
            </View>

            <View style={styles.startCard}>
              <View style={styles.startCardHeading}>
                <View style={styles.startIcon}>
                  <Feather name="navigation" size={19} color={colors.primary} />
                </View>
                <View style={styles.startHeadingText}>
                  <Text style={styles.eyebrow}>NEW RECORDING</Text>
                  <Text style={styles.cardTitle}>Start a ride</Text>
                </View>
              </View>
              <Text style={styles.fieldLabel}>
                RIDE NAME <Text style={styles.optionalText}>OPTIONAL</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={rideName}
                onChangeText={setRideName}
                placeholder="e.g. Home to work"
                placeholderTextColor={colors.mutedForeground}
                maxLength={60}
                returnKeyType="done"
              />
              <Pressable
                style={[styles.primaryButton, (!isReady || busy) && styles.disabledButton]}
                onPress={() => void startRide()}
                disabled={!isReady || busy}
              >
                <Feather name="play" size={17} color={colors.primaryForeground} />
                <Text style={styles.primaryButtonText}>
                  {!isReady ? 'Loading…' : busy ? 'Starting…' : 'Start ride'}
                </Text>
              </Pressable>
              <View style={styles.permissionHint}>
                <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                <Text style={styles.permissionHintText}>
                  Location access is needed for speed and distance. “Allow all the time” enables lock-screen tracking.
                </Text>
              </View>
            </View>
            {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
          </View>
        )}

        {(!selectedRide || historyExpanded) && (
          <View style={styles.historySection}>
            <View style={styles.historyHeading}>
              <View>
                <Text style={styles.eyebrow}>YOUR TRIPS</Text>
                <Text style={styles.historyTitle}>Ride history</Text>
              </View>
              {rides.length > 3 && (
                <Pressable onPress={() => setHistoryExpanded((value) => !value)}>
                  <Text style={styles.textLink}>{historyExpanded ? 'Show less' : 'See all'}</Text>
                </Pressable>
              )}
            </View>
            {rides.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Feather name="map" size={19} color={colors.mutedForeground} />
                <Text style={styles.emptyTitle}>No rides yet</Text>
                <Text style={styles.mutedText}>Your completed trips will appear here.</Text>
              </View>
            ) : (
              visibleRides.map((ride) => (
                <Pressable
                  style={styles.historyCard}
                  key={ride.id}
                  onPress={() => setSelectedRide(ride)}
                >
                  <View style={styles.historyCardIcon}>
                    <Feather name="navigation" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.historyCardMain}>
                    <Text style={styles.historyRideName}>{ride.name}</Text>
                    <Text style={styles.mutedText}>
                      {formatRideDate(ride.startAt)} · {formatDuration(ride.durationSeconds)}
                    </Text>
                  </View>
                  <View style={styles.historyDistance}>
                    <Text style={styles.historyDistanceValue}>{num(ride.distanceKm).toFixed(1)}</Text>
                    <Text style={styles.mutedText}>km</Text>
                  </View>
                  <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </View>
        )}

        <View style={styles.footerNote}>
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={styles.footerNoteText}>
            Speed, distance, and stop intervals are estimated from GPS. Signal quality can vary by device and route.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={fuelDialogOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setFuelDialogOpen(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalRoot}>
          <Pressable style={styles.modalScrim} onPress={() => setFuelDialogOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeading}>
              <View>
                <Text style={styles.eyebrow}>RIDE EXPENSES</Text>
                <Text style={styles.modalTitle}>Add fuel</Text>
              </View>
              <Pressable
                style={styles.iconButton}
                onPress={() => setFuelDialogOpen(false)}
                accessibilityLabel="Close fuel form"
              >
                <Feather name="x" size={20} color={colors.foreground} />
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>LITRES</Text>
            <TextInput
              style={styles.input}
              value={fuelLitres}
              onChangeText={setFuelLitres}
              placeholder="e.g. 4.5"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              autoFocus
            />
            <Text style={styles.fieldLabel}>
              PRICE PER LITRE <Text style={styles.optionalText}>OPTIONAL</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={fuelPrice}
              onChangeText={setFuelPrice}
              placeholder="e.g. 105"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
            />
            <Pressable style={styles.primaryButton} onPress={() => void addFuel()}>
              <Feather name="plus" size={18} color={colors.primaryForeground} />
              <Text style={styles.primaryButtonText}>Save fuel entry</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    page: { paddingHorizontal: 20, paddingBottom: 28 },
    topBar: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 21,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    brandMark: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.foreground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandName: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: colors.foreground },
    brandCaption: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 9,
      letterSpacing: 1.3,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    historyButton: {
      minHeight: 40,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 22,
      paddingHorizontal: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    historyButtonText: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: colors.foreground },
    sectionGap: { gap: 18 },
    heroCopy: { marginBottom: 2 },
    heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    heroEyebrow: {
      fontFamily: 'DMSans_700Bold',
      color: colors.primary,
      fontSize: 10,
      letterSpacing: 1.8,
    },
    heroEyebrowDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
      marginRight: 7,
    },
    heroTitle: {
      fontFamily: 'DMSans_700Bold',
      color: colors.foreground,
      fontSize: 35,
      lineHeight: 38,
      letterSpacing: -1.6,
      maxWidth: 300,
    },
    heroAccent: { color: colors.primary },
    heroBody: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      lineHeight: 21,
      color: colors.mutedForeground,
      marginTop: 10,
      maxWidth: 350,
    },
    startCard: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius + 4,
      padding: 18,
    },
    startCardHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
    startIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startHeadingText: { gap: 2 },
    eyebrow: {
      fontFamily: 'DMSans_700Bold',
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 1.4,
    },
    cardTitle: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 20,
      color: colors.foreground,
      letterSpacing: -0.4,
    },
    fieldLabel: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 9,
      letterSpacing: 1.2,
      color: colors.foreground,
      marginBottom: 8,
      marginTop: 5,
    },
    optionalText: {
      color: colors.mutedForeground,
      fontFamily: 'DMSans_400Regular',
      letterSpacing: 0.3,
    },
    input: {
      minHeight: 49,
      backgroundColor: colors.background,
      borderColor: colors.input,
      borderWidth: 1,
      borderRadius: 15,
      paddingHorizontal: 14,
      color: colors.foreground,
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      marginBottom: 16,
    },
    primaryButton: {
      minHeight: 53,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 9,
    },
    primaryButtonText: {
      fontFamily: 'DMSans_700Bold',
      color: colors.primaryForeground,
      fontSize: 14,
    },
    disabledButton: { opacity: 0.58 },
    permissionHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 11 },
    permissionHintText: {
      flex: 1,
      fontFamily: 'DMSans_400Regular',
      fontSize: 10,
      lineHeight: 15,
      color: colors.mutedForeground,
    },
    noticeText: {
      fontFamily: 'DMSans_500Medium',
      color: colors.primary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: -8,
    },
    historySection: { marginTop: 30 },
    historyHeading: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 12,
    },
    historyTitle: {
      fontFamily: 'DMSans_700Bold',
      color: colors.foreground,
      fontSize: 21,
      marginTop: 4,
      letterSpacing: -0.5,
    },
    textLink: { color: colors.primary, fontFamily: 'DMSans_700Bold', fontSize: 12, paddingVertical: 4 },
    emptyHistory: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      alignItems: 'center',
      paddingVertical: 23,
      gap: 6,
    },
    emptyTitle: { fontFamily: 'DMSans_700Bold', color: colors.foreground, fontSize: 14, marginTop: 2 },
    historyCard: {
      minHeight: 76,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 9,
    },
    historyCardIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyCardMain: { flex: 1, gap: 3 },
    historyRideName: { fontFamily: 'DMSans_700Bold', color: colors.foreground, fontSize: 14 },
    historyDistance: { alignItems: 'flex-end', marginRight: 2 },
    historyDistanceValue: { fontFamily: 'DMSans_700Bold', color: colors.foreground, fontSize: 15 },
    activeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    recordingLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    activeTitle: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 28,
      color: colors.foreground,
      letterSpacing: -1,
      marginBottom: 3,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    distanceCard: {
      backgroundColor: colors.foreground,
      borderRadius: colors.radius + 4,
      padding: 20,
    },
    distanceCardEyebrow: { color: colors.secondary },
    distanceCardSubtext: { color: colors.muted },
    distanceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginVertical: 6 },
    distanceValue: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 47,
      lineHeight: 50,
      color: colors.background,
      letterSpacing: -2.2,
    },
    distanceUnit: { fontFamily: 'DMSans_700Bold', fontSize: 18, color: colors.primary },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
    metricCard: {
      width: '48%',
      flexGrow: 1,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      padding: 14,
      gap: 5,
    },
    metricIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    metricLabel: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: colors.mutedForeground },
    metricValue: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 19,
      color: colors.foreground,
      letterSpacing: -0.6,
    },
    backgroundNote: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      padding: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    backgroundNoteText: {
      flex: 1,
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: colors.mutedForeground,
    },
    actionRow: { flexDirection: 'row', gap: 11 },
    secondaryButton: {
      minHeight: 52,
      borderRadius: 16,
      borderColor: colors.border,
      borderWidth: 1,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
    },
    secondaryButtonText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: colors.foreground },
    fuelButton: { flex: 1 },
    finishButton: { flex: 1.25 },
    discardLink: { alignSelf: 'center', padding: 6 },
    discardText: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: colors.destructive },
    summaryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    summaryBadge: {
      backgroundColor: colors.secondary,
      borderRadius: 99,
      paddingHorizontal: 11,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    summaryBadgeText: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: colors.secondaryForeground,
    },
    summaryTitle: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 30,
      color: colors.foreground,
      letterSpacing: -1,
    },
    gpsWarning: {
      backgroundColor: colors.card,
      borderColor: colors.destructive,
      borderWidth: 1,
      borderRadius: colors.radius,
      padding: 13,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    gpsWarningText: {
      flex: 1,
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      lineHeight: 17,
      color: colors.foreground,
    },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: colors.radius,
      padding: 15,
      gap: 9,
    },
    timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 6 },
    timelineDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
      marginTop: 5,
    },
    timelineContent: { flex: 1, gap: 2 },
    timelineTitle: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: colors.foreground },
    listRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    listMain: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: colors.foreground },
    mutedText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: colors.mutedForeground },
    footerNote: {
      marginTop: 28,
      paddingTop: 15,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    footerNoteText: {
      flex: 1,
      fontFamily: 'DMSans_400Regular',
      fontSize: 11,
      lineHeight: 16,
      color: colors.mutedForeground,
    },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 20, 30, 0.46)' },
    modalCard: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      borderColor: colors.border,
      borderWidth: 1,
    },
    modalHeading: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    modalTitle: { fontFamily: 'DMSans_700Bold', fontSize: 22, color: colors.foreground },
  });
}
