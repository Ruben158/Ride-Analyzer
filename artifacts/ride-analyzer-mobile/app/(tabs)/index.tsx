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

export default function RideScreen() {
  const colors = useColors();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [live, setLive] = useState<RideSummary | null>(null);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const
