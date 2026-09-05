import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Activity,
  CarFront,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Droplets,
  Gauge,
  History,
  Info,
  LocateFixed,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  Route as RouteIcon,
  Smartphone,
  Timer,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';

const queryClient = new QueryClient();
const STORAGE_KEY = 'ride-analyzer-live-rides-v1';

type WaitingPeriod = {
  id: string;
  startAt: string;
  endAt: string;
  durationSeconds: number;
};

type FuelEntry = {
  id: string;
  addedAt: string;
  litres: number;
  pricePerLitre: number;
};

type Ride = {
  id: string;
  label: string;
  date: string;
  startedAt: string;
  endedAt: string;
  distanceKm: number;
  fuelLitres: number;
  fuelCost: number;
  durationMinutes: number;
  trafficWaitMinutes: number;
  averageSpeedKmh: number;
  topSpeedKmh: number;
  waitingPeriods: WaitingPeriod[];
  fuelEntries: FuelEntry[];
};

type LiveStats = {
  elapsedSeconds: number;
  speedKmh: number | null;
  averageSpeedKmh: number;
  topSpeedKmh: number;
  distanceKm: number;
  waitingSeconds: number;
  waitingPeriods: WaitingPeriod[];
  fuelLitres: number;
  fuelCost: number;
};

type MotionPermission = 'unknown' | 'requesting' | 'granted' | 'denied';
type TrackingPhase = 'ready' | 'active' | 'summary';

type MotionEventConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const emptyStats: LiveStats = {
  elapsedSeconds: 0,
  speedKmh: null,
  averageSpeedKmh: 0,
  topSpeedKmh: 0,
  distanceKm: 0,
  waitingSeconds: 0,
  waitingPeriods: [],
  fuelLitres: 0,
  fuelCost: 0,
};

const readRides = (): Ride[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Ride[]) : [];
  } catch {
    return [];
  }
};

const todayString = () => new Date().toISOString().slice(0, 10);
const formatNumber = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : '0.0';
const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};
const formatClock = (value: string) =>
  new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
const sumWaiting = (periods: WaitingPeriod[]) =>
  periods.reduce((total, period) => total + period.durationSeconds, 0);
const haversineMetres = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) => {
  const earthRadius = 6371000;
  const latitudeDelta = ((latitudeB - latitudeA) * Math.PI) / 180;
  const longitudeDelta = ((longitudeB - longitudeA) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((latitudeA * Math.PI) / 180) *
      Math.cos((latitudeB * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function SensorPill({
  icon: Icon,
  label,
  active = false,
}: {
  icon: typeof Activity;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${
        active
          ? 'border-[#baca88]/40 bg-[#baca88]/10 text-[#c8d796]'
          : 'border-[#526073] bg-transparent text-[#9da8ae]'
      }`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  unit,
  icon: Icon,
  accent = 'orange',
}: {
  label: string;
  value: string;
  unit?: string;
  icon: typeof Gauge;
  accent?: 'orange' | 'lime' | 'blue' | 'ink';
}) {
  const colors = {
    orange: 'bg-[#f8d9cc] text-[#cc5b38]',
    lime: 'bg-[#e6edc4] text-[#61752d]',
    blue: 'bg-[#d8e8e7] text-[#367271]',
    ink: 'bg-[#dfe5eb] text-[#344354]',
  };
  return (
    <div className="rounded-2xl border border-[#ded7ca] bg-[#faf7ef] p-4">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${colors[accent]}`}>
        <Icon size={16} />
      </span>
      <div className="mt-5 flex items-end gap-1.5">
        <strong className="font-mono text-[25px] leading-none tracking-[-.08em] text-[#222a39]">
          {value}
        </strong>
        {unit && <span className="pb-0.5 text-xs text-slate-500">{unit}</span>}
      </div>
      <p className="mt-2 text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function FuelDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (litres: number, price: number) => void;
}) {
  const [litres, setLitres] = useState('');
  const [price, setPrice] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(litres);
    if (!amount || amount <= 0) return;
    onSave(amount, Number(price) > 0 ? Number(price) : 0);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2430]/55 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[24px] border border-[#e1d9cd] bg-[#faf7ef] p-6 shadow-[0_24px_80px_rgba(31,38,48,.3)]"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e6edc4] text-[#61752d]">
              <Droplets size={19} />
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-[-.06em] text-[#222a39]">
              Add fuel
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Log what you put in during this ride.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-[#eee7db] hover:text-[#222a39]"
            aria-label="Close fuel dialog"
          >
            <X size={17} />
          </button>
        </div>
        <label className="mt-7 block">
          <span className="mb-1.5 flex justify-between text-[11px] font-bold uppercase tracking-[.12em] text-slate-500">
            Fuel added <span className="font-mono normal-case tracking-normal">litres</span>
          </span>
          <input
            autoFocus
            data-testid="input-live-fuel"
            type="number"
            min="0.01"
            step="0.01"
            value={litres}
            onChange={(event) => setLitres(event.target.value)}
            placeholder="e.g. 12.5"
            className="h-12 w-full rounded-xl border border-[#d7cec0] bg-[#fffdf8] px-4 font-mono text-base outline-none transition focus:border-[#db6742] focus:ring-4 focus:ring-[#db6742]/10"
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 flex justify-between text-[11px] font-bold uppercase tracking-[.12em] text-slate-500">
            Price <span className="font-mono normal-case tracking-normal">per litre · optional</span>
          </span>
          <input
            data-testid="input-live-fuel-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="e.g. 1.85"
            className="h-12 w-full rounded-xl border border-[#d7cec0] bg-[#fffdf8] px-4 font-mono text-base outline-none transition focus:border-[#db6742] focus:ring-4 focus:ring-[#db6742]/10"
          />
        </label>
        <div className="mt-7 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 transition hover:bg-[#eee7db]"
          >
            Cancel
          </button>
          <button
            data-testid="button-save-live-fuel"
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#e66d43] px-5 text-sm font-bold text-[#222a39] shadow-[0_4px_0_#bb5232] transition hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
          >
            <Check size={16} /> Add to ride
          </button>
        </div>
      </form>
    </div>
  );
}

function WaitingTimeline({
  periods,
  activeSince,
}: {
  periods: WaitingPeriod[];
  activeSince?: string | null;
}) {
  if (!periods.length && !activeSince) {
    return (
      <div className="rounded-xl border border-dashed border-[#d6cdbf] bg-[#f7f3ea] px-4 py-5 text-sm text-slate-500">
        No waiting periods detected yet. The app records a pause when speed stays below 3 km/h.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {activeSince && (
        <div className="flex items-center justify-between rounded-xl bg-[#f8d9d0] px-4 py-3 text-sm text-[#9b4430]">
          <span className="flex items-center gap-2 font-semibold">
            <Pause size={15} /> Waiting since {formatClock(activeSince)}
          </span>
          <span className="font-mono text-xs">in progress</span>
        </div>
      )}
      {periods.map((period) => (
        <div
          key={period.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f7f3ea] px-4 py-3 text-sm"
        >
          <span className="flex items-center gap-2 font-semibold text-[#303746]">
            <Timer size={15} className="text-[#c85c3a]" />
            {formatClock(period.startAt)} → {formatClock(period.endAt)}
          </span>
          <span className="font-mono text-xs text-slate-500">
            {formatDuration(period.durationSeconds)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RideSummary({
  ride,
  onNewRide,
}: {
  ride: Ride;
  onNewRide: () => void;
}) {
  return (
    <section className="animate-rise rounded-[24px] bg-[#283344] p-5 text-[#f7f3ea] shadow-[0_18px_50px_rgba(40,51,68,.16)] sm:p-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2 text-[#baca88]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#baca88]/15">
              <Check size={17} />
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[.18em]">Ride complete</p>
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-[-.07em]">{ride.label}</h2>
          <p className="mt-1 text-sm text-[#aab4b5]">
            {formatDateTime(ride.startedAt)} → {formatClock(ride.endedAt)}
          </p>
        </div>
        <button
          data-testid="button-start-another"
          onClick={onNewRide}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#e66d43] px-4 text-sm font-bold text-[#222a39] transition hover:-translate-y-0.5 hover:bg-[#ef7950]"
        >
          <Play size={15} fill="currentColor" /> Start another
        </button>
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3 border-t border-[#465263] pt-5 sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Distance</p>
          <p className="mt-1 font-mono text-xl font-bold">{formatNumber(ride.distanceKm)} <span className="text-xs font-normal text-[#89959c]">km</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Average speed</p>
          <p className="mt-1 font-mono text-xl font-bold">{formatNumber(ride.averageSpeedKmh)} <span className="text-xs font-normal text-[#89959c]">km/h</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Top speed</p>
          <p className="mt-1 font-mono text-xl font-bold text-[#f6bd80]">{formatNumber(ride.topSpeedKmh, 0)} <span className="text-xs font-normal text-[#89959c]">km/h</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Total time</p>
          <p className="mt-1 font-mono text-xl font-bold">{formatDuration(ride.durationMinutes * 60)}</p>
        </div>
      </div>
      <div className="mt-6 border-t border-[#465263] pt-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#f6bd80]">Traffic timeline</p>
            <p className="mt-1 text-xs text-[#aab4b5]">
              {ride.waitingPeriods.length
                ? `${ride.waitingPeriods.length} waiting ${ride.waitingPeriods.length === 1 ? 'period' : 'periods'} detected`
                : 'No waiting periods detected'}
            </p>
          </div>
          <p className="font-mono text-lg font-bold">{formatDuration(ride.trafficWaitMinutes * 60)}</p>
        </div>
        {ride.waitingPeriods.length ? (
          <div className="space-y-2">
            {ride.waitingPeriods.map((period) => (
              <div key={period.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#202a38] px-4 py-3 text-xs">
                <span className="flex items-center gap-2 text-[#dce1df]"><Timer size={14} className="text-[#f6bd80]" /> {formatClock(period.startAt)} to {formatClock(period.endAt)}</span>
                <span className="font-mono text-[#aab4b5]">{formatDuration(period.durationSeconds)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-[#202a38] px-4 py-3 text-sm text-[#aab4b5]">You kept moving for the whole ride.</p>
        )}
      </div>
      <div className="mt-6 grid gap-3 border-t border-[#465263] pt-5 sm:grid-cols-2">
        <div className="rounded-xl bg-[#202a38] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Fuel added</p>
          <p className="mt-1 font-mono text-lg font-bold">{formatNumber(ride.fuelLitres, 2)} <span className="text-xs font-normal text-[#89959c]">litres</span></p>
        </div>
        <div className="rounded-xl bg-[#202a38] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Fuel cost</p>
          <p className="mt-1 font-mono text-lg font-bold">€{ride.fuelCost.toFixed(2)}</p>
        </div>
      </div>
    </section>
  );
}

function HistoryRow({ ride, onDelete }: { ride: Ride; onDelete: (id: string) => void }) {
  return (
    <div className="group border-b border-[#e4ded3] py-4 last:border-0">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e9e4d9] text-[#68716c]">
            <MapPin size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#303746]">{ride.label}</p>
            <p className="mt-0.5 text-xs text-slate-500">{formatDate(ride.date)} · {formatClock(ride.startedAt)} to {formatClock(ride.endedAt)}</p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 sm:flex sm:items-center sm:gap-7">
          <div><p className="font-mono text-sm font-bold text-[#303746]">{formatNumber(ride.distanceKm)}</p><p className="text-[10px] text-slate-500">km</p></div>
          <div><p className="font-mono text-sm font-bold text-[#303746]">{formatNumber(ride.averageSpeedKmh)}</p><p className="text-[10px] text-slate-500">avg km/h</p></div>
          <div><p className="font-mono text-sm font-bold text-[#303746]">{formatNumber(ride.topSpeedKmh, 0)}</p><p className="text-[10px] text-slate-500">top km/h</p></div>
          <div><p className="font-mono text-sm font-bold text-[#c85c3a]">{formatDuration(ride.trafficWaitMinutes * 60)}</p><p className="text-[10px] text-slate-500">waiting</p></div>
          <button
            data-testid={`button-delete-ride-${ride.id}`}
            onClick={() => onDelete(ride.id)}
            aria-label={`Delete ${ride.label}`}
            className="hidden h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-[#f8d9d0] hover:text-[#b8462f] sm:grid"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <button
        onClick={() => onDelete(ride.id)}
        aria-label={`Delete ${ride.label}`}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#b9573b] sm:hidden"
      >
        <Trash2 size={13} /> Delete ride
      </button>
    </div>
  );
}

function Home() {
  const [rides, setRides] = useState<Ride[]>(readRides);
  const [phase, setPhase] = useState<TrackingPhase>('ready');
  const [label, setLabel] = useState('');
  const [live, setLive] = useState<LiveStats>(emptyStats);
  const [summary, setSummary] = useState<Ride | null>(null);
  const [showFuelDialog, setShowFuelDialog] = useState(false);
  const [notice, setNotice] = useState('');
  const [motionPermission, setMotionPermission] = useState<MotionPermission>('unknown');
  const [gpsState, setGpsState] = useState<'unknown' | 'searching' | 'ready' | 'denied'>('unknown');
  const [activeWaitSince, setActiveWaitSince] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const startAtRef = useRef<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const motionHandlerRef = useRef<((event: DeviceMotionEvent) => void) | null>(null);
  const previousPositionRef = useRef<GeolocationPosition | null>(null);
  const lastSpeedRef = useRef<number | null>(null);
  const gpsStateRef = useRef<'unknown' | 'searching' | 'ready' | 'denied'>('unknown');
  const lastMotionAtRef = useRef(0);
  const motionIsLowRef = useRef(true);
  const waitStartRef = useRef<string | null>(null);
  const waitingPeriodsRef = useRef<WaitingPeriod[]>([]);
  const distanceMetresRef = useRef(0);
  const topSpeedRef = useRef(0);
  const fuelEntriesRef = useRef<FuelEntry[]>([]);
  const liveRef = useRef<LiveStats>(emptyStats);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
  }, [rides]);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    gpsStateRef.current = gpsState;
  }, [gpsState]);

  useEffect(() => {
    if (phase !== 'active') return;
    const ticker = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      if (motionHandlerRef.current) window.removeEventListener('devicemotion', motionHandlerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const orderedRides = useMemo(
    () => [...rides].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [rides],
  );
  const totalDistance = useMemo(
    () => rides.reduce((sum, ride) => sum + ride.distanceKm, 0),
    [rides],
  );
  const totalWaiting = useMemo(
    () => rides.reduce((sum, ride) => sum + ride.trafficWaitMinutes, 0),
    [rides],
  );

  const setLiveStats = (next: LiveStats) => {
    liveRef.current = next;
    setLive(next);
  };

  const cleanupSensors = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (motionHandlerRef.current) {
      window.removeEventListener('devicemotion', motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
  };

  const closeWaitingPeriod = (endedAt: string) => {
    const startedAt = waitStartRef.current;
    if (!startedAt) return;
    const durationSeconds = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
    );
    const period: WaitingPeriod = {
      id: `wait-${Date.now()}`,
      startAt: startedAt,
      endAt: endedAt,
      durationSeconds,
    };
    waitingPeriodsRef.current = [...waitingPeriodsRef.current, period];
    waitStartRef.current = null;
    setActiveWaitSince(null);
    setLiveStats({
      ...liveRef.current,
      waitingPeriods: waitingPeriodsRef.current,
      waitingSeconds: sumWaiting(waitingPeriodsRef.current),
    });
  };

  const evaluateWaiting = () => {
    if (!startAtRef.current) return;
    const now = new Date();
    const nowIso = now.toISOString();
    const gpsSpeed = lastSpeedRef.current;
    const hasRecentMotion = Date.now() - lastMotionAtRef.current < 4000;
    const isWaiting =
      gpsSpeed !== null
        ? gpsSpeed < 3
        : gpsStateRef.current === 'denied' && hasRecentMotion && motionIsLowRef.current;
    if (isWaiting && !waitStartRef.current) {
      waitStartRef.current = nowIso;
      setActiveWaitSince(nowIso);
    } else if (!isWaiting && waitStartRef.current) {
      closeWaitingPeriod(nowIso);
    }
    const openWaitSeconds = waitStartRef.current
      ? Math.max(
          0,
          Math.round((now.getTime() - new Date(waitStartRef.current).getTime()) / 1000),
        )
      : 0;
    const elapsedSeconds = Math.max(
      0,
      Math.round((now.getTime() - new Date(startAtRef.current).getTime()) / 1000),
    );
    const distanceKm = distanceMetresRef.current / 1000;
    setLiveStats({
      ...liveRef.current,
      elapsedSeconds,
      averageSpeedKmh: elapsedSeconds > 0 ? distanceKm / (elapsedSeconds / 3600) : 0,
      waitingSeconds: sumWaiting(waitingPeriodsRef.current) + openWaitSeconds,
    });
  };

  const enableMotion = async () => {
    if (!('DeviceMotionEvent' in window)) {
      setMotionPermission('denied');
      return;
    }
    const motionConstructor = window.DeviceMotionEvent as MotionEventConstructor;
    setMotionPermission('requesting');
    try {
      if (motionConstructor.requestPermission) {
        const permission = await motionConstructor.requestPermission();
        if (permission !== 'granted') {
          setMotionPermission('denied');
          return;
        }
      }
      const handler = (event: DeviceMotionEvent) => {
        const acceleration = event.acceleration;
        const x = acceleration?.x ?? null;
        const y = acceleration?.y ?? null;
        const z = acceleration?.z ?? null;
        if (x === null || y === null || z === null) return;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        motionIsLowRef.current = magnitude < 0.25;
        lastMotionAtRef.current = Date.now();
      };
      motionHandlerRef.current = handler;
      window.addEventListener('devicemotion', handler);
      setMotionPermission('granted');
    } catch {
      setMotionPermission('denied');
    }
  };

  const startRide = async () => {
    const startedAt = new Date().toISOString();
    startAtRef.current = startedAt;
    previousPositionRef.current = null;
    lastSpeedRef.current = null;
    lastMotionAtRef.current = Date.now();
    motionIsLowRef.current = true;
    waitStartRef.current = null;
    waitingPeriodsRef.current = [];
    distanceMetresRef.current = 0;
    topSpeedRef.current = 0;
    fuelEntriesRef.current = [];
    setLiveStats(emptyStats);
    setSummary(null);
    setPhase('active');
    setGpsState('searching');
    setNotice('Ride started. Keep the phone steady and drive safely.');

    await enableMotion();

    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const previous = previousPositionRef.current;
          if (previous) {
            const deltaMetres = haversineMetres(
              previous.coords.latitude,
              previous.coords.longitude,
              position.coords.latitude,
              position.coords.longitude,
            );
            if (deltaMetres < 500) distanceMetresRef.current += Math.max(0, deltaMetres);
            const elapsed = (position.timestamp - previous.timestamp) / 1000;
            if (elapsed > 0 && (position.coords.speed === null || !Number.isFinite(position.coords.speed) || position.coords.speed < 0)) {
              lastSpeedRef.current = Math.max(0, (deltaMetres / elapsed) * 3.6);
            }
          }
          previousPositionRef.current = position;
          const reportedSpeed = position.coords.speed;
          if (reportedSpeed !== null && Number.isFinite(reportedSpeed) && reportedSpeed >= 0) {
            lastSpeedRef.current = reportedSpeed * 3.6;
          }
          const speed = Math.max(0, lastSpeedRef.current ?? 0);
          topSpeedRef.current = Math.max(topSpeedRef.current, speed);
          setGpsState('ready');
          setLiveStats({
            ...liveRef.current,
            speedKmh: lastSpeedRef.current,
            topSpeedKmh: topSpeedRef.current,
            distanceKm: distanceMetresRef.current / 1000,
          });
        },
        () => setGpsState('denied'),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
      );
    } else {
      setGpsState('denied');
    }
    intervalRef.current = window.setInterval(evaluateWaiting, 1000);
  };

  const addFuel = (litres: number, pricePerLitre: number) => {
    const entry: FuelEntry = {
      id: `fuel-${Date.now()}`,
      addedAt: new Date().toISOString(),
      litres,
      pricePerLitre,
    };
    fuelEntriesRef.current = [...fuelEntriesRef.current, entry];
    const fuelLitres = fuelEntriesRef.current.reduce((sum, item) => sum + item.litres, 0);
    const fuelCost = fuelEntriesRef.current.reduce(
      (sum, item) => sum + item.litres * item.pricePerLitre,
      0,
    );
    setLiveStats({ ...liveRef.current, fuelLitres, fuelCost });
    setShowFuelDialog(false);
    setNotice(`${formatNumber(litres, 2)} litres added to this ride.`);
  };

  const endRide = () => {
    if (!startAtRef.current) return;
    const endedAt = new Date().toISOString();
    closeWaitingPeriod(endedAt);
    const finalPeriods = [...waitingPeriodsRef.current];
    const elapsedSeconds = Math.max(
      1,
      Math.round((new Date(endedAt).getTime() - new Date(startAtRef.current).getTime()) / 1000),
    );
    const distanceKm = distanceMetresRef.current / 1000;
    const fuelLitres = fuelEntriesRef.current.reduce((sum, item) => sum + item.litres, 0);
    const fuelCost = fuelEntriesRef.current.reduce(
      (sum, item) => sum + item.litres * item.pricePerLitre,
      0,
    );
    const completedRide: Ride = {
      id: `ride-${Date.now()}`,
      label: label.trim() || `Ride · ${formatDate(todayString())}`,
      date: todayString(),
      startedAt: startAtRef.current,
      endedAt,
      distanceKm,
      fuelLitres,
      fuelCost,
      durationMinutes: elapsedSeconds / 60,
      trafficWaitMinutes: sumWaiting(finalPeriods) / 60,
      averageSpeedKmh: distanceKm / (elapsedSeconds / 3600),
      topSpeedKmh: topSpeedRef.current,
      waitingPeriods: finalPeriods,
      fuelEntries: [...fuelEntriesRef.current],
    };
    cleanupSensors();
    setLiveStats({
      ...liveRef.current,
      elapsedSeconds,
      distanceKm,
      averageSpeedKmh: completedRide.averageSpeedKmh,
      topSpeedKmh: completedRide.topSpeedKmh,
      waitingPeriods: finalPeriods,
      waitingSeconds: sumWaiting(finalPeriods),
      fuelLitres,
      fuelCost,
    });
    setRides((current) => [completedRide, ...current]);
    setSummary(completedRide);
    setPhase('summary');
    setActiveWaitSince(null);
    startAtRef.current = null;
    setNotice('Ride ended. Your summary is ready.');
  };

  const resetForNewRide = () => {
    cleanupSensors();
    startAtRef.current = null;
    setPhase('ready');
    setSummary(null);
    setLabel('');
    setLiveStats(emptyStats);
    setMotionPermission('unknown');
    setGpsState('unknown');
    setActiveWaitSince(null);
  };

  const deleteRide = (id: string) => {
    const ride = rides.find((item) => item.id === id);
    if (!ride || !window.confirm(`Delete “${ride.label}” from your ride history?`)) return;
    setRides((current) => current.filter((item) => item.id !== id));
    setNotice('Ride deleted.');
  };

  const clearAll = () => {
    if (!rides.length || !window.confirm('Delete every saved ride from this browser?')) return;
    setRides([]);
    setNotice('Ride history cleared.');
  };

  const liveWaitingSeconds = live.waitingSeconds;
  const displayedElapsed = phase === 'active' && startAtRef.current
    ? Math.max(0, Math.round((currentTime - new Date(startAtRef.current).getTime()) / 1000))
    : live.elapsedSeconds;

  return (
    <div className="noise min-h-[100dvh] bg-[#f1ede4] text-[#222a39]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1600px]">
        <aside className="instrument-grid hidden w-[238px] shrink-0 flex-col bg-[#222a39] px-5 py-6 text-[#f7f3ea] lg:flex">
          <div className="flex items-center gap-3 px-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e66d43] text-[#222a39]">
              <Gauge size={21} strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-sm font-bold tracking-[-.02em]">Ride Analyzer</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[.16em] text-[#abb5b9]">live road recorder</p>
            </div>
          </div>
          <div className="mt-14">
            <p className="px-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#8e9aa1]">Your instrument</p>
            <div className="mt-3 rounded-xl bg-[#313c4d] px-3 py-3.5 text-sm font-semibold text-[#f7f3ea]">
              <span className="mr-2 text-[#e66d43]">●</span> Live ride
              <ChevronRight className="float-right mt-0.5 text-[#8e9aa1]" size={15} />
            </div>
          </div>
          <div className="mt-auto rounded-2xl border border-[#3d4856] bg-[#2c3748] p-4">
            <div className="flex items-center gap-2 text-[#bdcb88]">
              <CircleDot size={15} className="pulse-dot" />
              <span className="text-xs font-bold">Phone sensors</span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[#9da8ae]">
              Motion detects pauses. GPS supplies the most accurate speed and distance when available.
            </p>
          </div>
          <p className="mt-5 px-2 text-[10px] text-[#697782]">v2.0 · made for the drive</p>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-[#ded8cc] bg-[#f1ede4]/90 px-5 py-4 backdrop-blur-md sm:px-8 lg:px-12">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e66d43] text-[#222a39]">
                <Gauge size={18} />
              </span>
              <span className="text-sm font-bold">Ride Analyzer</span>
            </div>
            <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex">
              <span className={`h-2 w-2 rounded-full ${phase === 'active' ? 'bg-[#e66d43] animate-pulse' : 'bg-[#9fb46c]'}`} />
              {phase === 'active' ? 'Recording live ride' : 'Ready to record'} <span className="mx-1 text-[#c5bcad]">/</span> Dashboard
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-xs text-slate-500 sm:inline">Data lives on this device</span>
              <button
                data-testid="button-clear-history-header"
                onClick={clearAll}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8d0c3] bg-[#f7f3ea] px-3 text-xs font-bold text-[#59616b] transition hover:border-[#bfb5a6] hover:text-[#222a39]"
              >
                <History size={13} /> History
              </button>
            </div>
          </header>

          <div className="px-5 pb-14 pt-7 sm:px-8 lg:px-12 lg:pt-10">
            <section className="animate-rise flex flex-col justify-between gap-6 border-b border-[#ddd6c9] pb-8 sm:flex-row sm:items-end">
              <div>
                <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#db6742]">
                  <span className={`h-1.5 w-1.5 rounded-full ${phase === 'active' ? 'animate-pulse bg-[#db6742]' : 'bg-[#db6742]'}`} />
                  {phase === 'active' ? 'Ride in progress' : phase === 'summary' ? 'After the drive' : 'Before the drive'}
                </p>
                <h1 className="max-w-2xl text-[clamp(2.1rem,5vw,4.4rem)] font-bold leading-[.94] tracking-[-.075em] text-[#222a39]">
                  {phase === 'active' ? <>Keep your eyes<br /><span className="text-[#db6742]">on the road.</span></> : phase === 'summary' ? <>Every drive<br /><span className="text-[#db6742]">tells a story.</span></> : <>Ready when<br /><span className="text-[#db6742]">you are.</span></>}
                </h1>
                <p className="mt-5 max-w-lg text-sm leading-6 text-slate-500">
                  {phase === 'active'
                    ? 'Your phone is quietly reading motion, speed, distance, and the moments traffic asks you to wait.'
                    : 'Start a ride once, let your phone do the recording, and get the full timeline when you arrive.'}
                </p>
              </div>
              <div className="w-full max-w-[270px] rounded-2xl bg-[#e5ecc5] p-4 text-[#4e6127] sm:mb-1">
                <div className="flex items-start justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.16em]">Road recorded</span>
                  <TrendingUp size={17} />
                </div>
                <p className="mt-4 font-mono text-3xl font-bold tracking-[-.08em]">{formatNumber(totalDistance)} <span className="text-sm font-normal tracking-normal">km</span></p>
                <p className="mt-1 text-xs text-[#6e7d43]">{rides.length ? `${rides.length} ${rides.length === 1 ? 'ride' : 'rides'} saved` : 'No rides saved yet'}</p>
              </div>
            </section>

            {phase === 'ready' && (
              <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
                <div className="animate-rise rounded-[24px] border border-[#ded7ca] bg-[#faf7ef] p-5 shadow-[0_14px_40px_rgba(44,42,34,.05)] sm:p-7">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f8d9cc] text-[#cc5b38]"><Navigation size={19} /></span>
                    <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#db6742]">New recording</p><h2 className="mt-1 text-2xl font-bold tracking-[-.06em]">Start a ride</h2></div>
                  </div>
                  <p className="mt-5 max-w-md text-sm leading-6 text-slate-500">Tap start before you pull away. We’ll ask for phone sensor access and keep the live recorder running until you end the ride.</p>
                  <label className="mt-6 block max-w-md">
                    <span className="mb-1.5 flex justify-between text-[11px] font-bold uppercase tracking-[.12em] text-slate-500"><span>Ride name</span><span className="font-normal normal-case tracking-normal text-slate-400">optional</span></span>
                    <input data-testid="input-ride-name" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Home to work" className="h-12 w-full rounded-xl border border-[#d7cec0] bg-[#fffdf8] px-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#db6742] focus:ring-4 focus:ring-[#db6742]/10" />
                  </label>
                  <button data-testid="button-start-ride" onClick={startRide} className="mt-6 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#e66d43] px-5 py-3.5 text-sm font-bold text-[#222a39] shadow-[0_5px_0_#bb5232] transition hover:-translate-y-0.5 hover:bg-[#ee7950] active:translate-y-0 active:shadow-none sm:w-auto sm:min-w-[190px]">
                    <Play size={17} fill="currentColor" /> Start ride
                  </button>
                  <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Smartphone size={14} /> Works best with your phone mounted securely.</p>
                </div>
                <div className="animate-rise stagger-1 instrument-grid relative overflow-hidden rounded-[24px] bg-[#283344] p-5 text-[#f7f3ea] sm:p-7">
                  <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full border-[20px] border-[#3c485a] opacity-50" />
                  <div className="relative">
                    <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#aab4b5]">How it works</p>
                    <div className="mt-6 space-y-5">
                      {[
                        ['01', 'Start ride', 'Allow motion and location when your phone asks.'],
                        ['02', 'Keep driving', 'Live speed, top speed, distance, and pauses update as you go.'],
                        ['03', 'End ride', 'Get the exact waiting timeline and a saved ride summary.'],
                      ].map(([number, title, copy]) => (
                        <div key={number} className="flex gap-3">
                          <span className="font-mono text-xs text-[#f6bd80]">{number}</span>
                          <div><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-[#9da8ae]">{copy}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {phase === 'active' && (
              <section className="mt-8 animate-rise">
                <div className="instrument-grid overflow-hidden rounded-[24px] bg-[#283344] p-5 text-[#f7f3ea] shadow-[0_18px_50px_rgba(40,51,68,.16)] sm:p-7">
                  <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                    <div>
                      <div className="flex items-center gap-2 text-[#f6bd80]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#e66d43]" /><p className="text-[10px] font-bold uppercase tracking-[.18em]">Recording now</p></div>
                      <h2 className="mt-3 text-2xl font-bold tracking-[-.06em]">{label.trim() || 'Untitled ride'}</h2>
                      <p className="mt-1 text-sm text-[#aab4b5]">Started {startAtRef.current ? formatClock(startAtRef.current) : 'now'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SensorPill icon={Activity} label={motionPermission === 'granted' ? 'Motion on' : motionPermission === 'denied' ? 'Motion off' : 'Motion…'} active={motionPermission === 'granted'} />
                      <SensorPill icon={LocateFixed} label={gpsState === 'ready' ? 'GPS speed on' : gpsState === 'denied' ? 'GPS unavailable' : 'GPS…'} active={gpsState === 'ready'} />
                    </div>
                  </div>
                  <div className="mt-8 grid gap-5 lg:grid-cols-[1.05fr_1fr]">
                    <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-5 sm:p-7">
                      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#89959c]">Current speed</p>
                      <div className="mt-4 flex items-end gap-3">
                        <strong data-testid="live-current-speed" className="font-mono text-[clamp(4rem,10vw,7rem)] leading-[.8] tracking-[-.12em] text-[#f6bd80]">{live.speedKmh === null ? '—' : formatNumber(live.speedKmh, 0)}</strong>
                        <span className="pb-1 text-sm text-[#aab4b5]">km/h<br /><span className="text-xs text-[#89959c]">live reading</span></span>
                      </div>
                      {motionPermission === 'denied' || gpsState === 'denied' ? <p className="mt-7 flex items-start gap-2 text-xs leading-5 text-[#f6bd80]"><Info size={14} className="mt-0.5 shrink-0" />{gpsState === 'denied' ? 'Location access is off. Speed and distance need GPS; motion can still identify movement pauses on supported phones.' : 'Motion access is off. Speed can still use GPS when available.'}</p> : <p className="mt-7 flex items-center gap-2 text-xs text-[#aab4b5]"><Zap size={14} className="text-[#baca88]" /> The recorder is running in the background of this screen.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-4"><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Average speed</p><p data-testid="live-average-speed" className="mt-3 font-mono text-2xl font-bold">{formatNumber(live.averageSpeedKmh)} <span className="text-xs font-normal text-[#89959c]">km/h</span></p></div>
                      <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-4"><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Top speed</p><p data-testid="live-top-speed" className="mt-3 font-mono text-2xl font-bold text-[#f6bd80]">{formatNumber(live.topSpeedKmh, 0)} <span className="text-xs font-normal text-[#89959c]">km/h</span></p></div>
                      <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-4"><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Elapsed</p><p className="mt-3 font-mono text-2xl font-bold">{formatDuration(displayedElapsed)}</p></div>
                      <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-4"><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Distance</p><p className="mt-3 font-mono text-2xl font-bold">{formatNumber(live.distanceKm)} <span className="text-xs font-normal text-[#89959c]">km</span></p></div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
                    <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-5">
                      <div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#f6bd80]">Traffic watch</p><p className="mt-1 text-xs text-[#aab4b5]">{activeWaitSince ? `Waiting since ${formatClock(activeWaitSince)}` : 'Pauses appear here automatically'}</p></div><p data-testid="live-wait-time" className="font-mono text-lg font-bold">{formatDuration(liveWaitingSeconds)}</p></div>
                      <WaitingTimeline periods={live.waitingPeriods} activeSince={activeWaitSince} />
                    </div>
                    <div className="rounded-2xl border border-[#465263] bg-[#202a38]/60 p-5">
                      <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#baca88]">Fuel during ride</p><p className="mt-2 font-mono text-3xl font-bold">{formatNumber(live.fuelLitres, 2)} <span className="text-xs font-normal text-[#89959c]">litres</span></p></div><Droplets size={20} className="text-[#baca88]" /></div>
                      <button data-testid="button-add-fuel" onClick={() => setShowFuelDialog(true)} className="mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#baca88]/40 bg-[#baca88]/10 text-sm font-bold text-[#d0dc9d] transition hover:bg-[#baca88]/20"><Plus size={16} /> Add fuel</button>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-center gap-2 text-xs text-[#89959c]"><Info size={14} /> Please stop the recording when you arrive.</p>
                    <button data-testid="button-end-ride" onClick={endRide} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#e66d43] px-6 text-sm font-bold text-[#222a39] shadow-[0_4px_0_#bb5232] transition hover:-translate-y-0.5 hover:bg-[#ee7950] active:translate-y-0 active:shadow-none"><SquareIcon /> End ride</button>
                  </div>
                </div>
              </section>
            )}

            {phase === 'summary' && summary && (
              <div className="mt-8">
                <RideSummary ride={summary} onNewRide={resetForNewRide} />
              </div>
            )}

            <section className="mt-5 grid gap-4 sm:grid-cols-3">
              <Metric icon={RouteIcon} label="Total distance" value={formatNumber(totalDistance)} unit="km" accent="orange" />
              <Metric icon={Clock3} label="Total time waiting" value={formatDuration(totalWaiting * 60)} accent="blue" />
              <Metric icon={Smartphone} label="Rides recorded" value={String(rides.length)} accent="lime" />
            </section>

            <section id="history" className="mt-8 animate-rise rounded-[22px] border border-[#ded7ca] bg-[#faf7ef] p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#db6742]">Ride history</p><h2 className="mt-2 text-xl font-bold tracking-[-.05em]">Your recorded drives</h2><p className="mt-1 text-xs text-slate-500">Every ride keeps its start, end, speed, and waiting timeline.</p></div>
                {rides.length > 0 && <button data-testid="button-clear-all-rides" onClick={clearAll} className="inline-flex items-center gap-1.5 self-start text-xs font-bold text-[#b9573b] transition hover:text-[#8f3c27]"><Trash2 size={13} /> Clear history</button>}
              </div>
              {orderedRides.length ? <div className="mt-5">{orderedRides.map((ride) => <HistoryRow key={ride.id} ride={ride} onDelete={deleteRide} />)}</div> : <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#cfc7b8] bg-[#f7f3ea] px-6 py-12 text-center"><span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#e6edc4] text-[#61752d]"><CarFront size={23} /></span><h3 className="font-bold text-[#222a39]">Your first drive is waiting</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Start a ride above. When you end it, the full speed and traffic timeline will appear here.</p></div>}
            </section>

            <footer className="flex flex-col gap-2 px-1 pb-2 pt-8 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#9fb46c]" /> Stored locally in your browser</span><span>Ride Analyzer · keep moving safely</span></footer>
          </div>
        </main>
      </div>
      {showFuelDialog && <FuelDialog onClose={() => setShowFuelDialog(false)} onSave={addFuel} />}
      {notice && <div data-testid="status-notice" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#222a39] px-4 py-3 text-sm font-semibold text-[#f7f3ea] shadow-[0_10px_30px_rgba(34,42,57,.25)] animate-rise"><Check size={16} className="text-[#bdcb88]" />{notice}</div>}
    </div>
  );
}

function SquareIcon() {
  return <span className="grid h-3 w-3 place-items-center rounded-[2px] border-2 border-current" />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;