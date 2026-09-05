import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CarFront,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Fuel,
  Gauge,
  Info,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Route as RouteIcon,
  Search,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();
const STORAGE_KEY = 'ride-analyzer-rides-v1';

type Ride = {
  id: string;
  date: string;
  label: string;
  distanceKm: number;
  fuelLitres: number;
  durationMinutes: number;
  trafficWaitMinutes: number;
  averageSpeedKmh: number;
  topSpeedKmh: number;
  fuelPricePerLitre: number;
  notes: string;
};

type RideForm = Omit<Ride, 'id'>;

const seedRides: Ride[] = [
  { id: 'seed-1', date: '2025-04-18', label: 'Home → studio', distanceKm: 18.6, fuelLitres: 1.42, durationMinutes: 37, trafficWaitMinutes: 8, averageSpeedKmh: 30.2, topSpeedKmh: 68, fuelPricePerLitre: 1.79, notes: 'A smooth Friday loop. Light on the ring road.' },
  { id: 'seed-2', date: '2025-04-21', label: 'Studio → coast', distanceKm: 42.8, fuelLitres: 3.18, durationMinutes: 51, trafficWaitMinutes: 5, averageSpeedKmh: 50.4, topSpeedKmh: 91, fuelPricePerLitre: 1.81, notes: 'Open road after the tolls.' },
  { id: 'seed-3', date: '2025-04-23', label: 'Market run', distanceKm: 11.2, fuelLitres: 1.04, durationMinutes: 29, trafficWaitMinutes: 12, averageSpeedKmh: 23.2, topSpeedKmh: 54, fuelPricePerLitre: 1.83, notes: 'School pickup traffic.' },
  { id: 'seed-4', date: '2025-04-25', label: 'Home → studio', distanceKm: 18.6, fuelLitres: 1.31, durationMinutes: 34, trafficWaitMinutes: 4, averageSpeedKmh: 32.8, topSpeedKmh: 71, fuelPricePerLitre: 1.84, notes: 'Best commute this month.' },
  { id: 'seed-5', date: '2025-04-27', label: 'Hillside lookout', distanceKm: 67.4, fuelLitres: 5.16, durationMinutes: 76, trafficWaitMinutes: 7, averageSpeedKmh: 53.2, topSpeedKmh: 96, fuelPricePerLitre: 1.82, notes: 'Long climb, cool air, worth the detour.' },
];

const todayString = () => new Date().toISOString().slice(0, 10);

const initialForm = (): RideForm => ({
  date: todayString(),
  label: '',
  distanceKm: 0,
  fuelLitres: 0,
  durationMinutes: 0,
  trafficWaitMinutes: 0,
  averageSpeedKmh: 0,
  topSpeedKmh: 0,
  fuelPricePerLitre: 1.85,
  notes: '',
});

const readRides = (): Ride[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Ride[];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedRides));
  } catch {
    return seedRides;
  }
  return seedRides;
};

const formatNumber = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '0.0';
const money = (value: number) => `€${value.toFixed(2)}`;
const formatDate = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const movingMinutes = (ride: Pick<Ride, 'durationMinutes' | 'trafficWaitMinutes'>) => Math.max(ride.durationMinutes - ride.trafficWaitMinutes, 0);
const economy = (ride: Pick<Ride, 'distanceKm' | 'fuelLitres'>) => ride.fuelLitres > 0 ? ride.distanceKm / ride.fuelLitres : 0;
const cost = (ride: Pick<Ride, 'fuelLitres' | 'fuelPricePerLitre'>) => ride.fuelLitres * ride.fuelPricePerLitre;
const trafficPercent = (ride: Pick<Ride, 'durationMinutes' | 'trafficWaitMinutes'>) => ride.durationMinutes > 0 ? (ride.trafficWaitMinutes / ride.durationMinutes) * 100 : 0;
const movingSpeed = (ride: Pick<Ride, 'distanceKm' | 'durationMinutes' | 'trafficWaitMinutes'>) => movingMinutes(ride) > 0 ? ride.distanceKm / (movingMinutes(ride) / 60) : 0;
const sortNewest = (rides: Ride[]) => [...rides].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));

function Field({ label, suffix, children, wide = false }: { label: string; suffix?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[.12em] text-slate-500">
        {label}
        {suffix && <span className="font-mono normal-case tracking-normal text-slate-400">{suffix}</span>}
      </span>
      {children}
    </label>
  );
}

function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return <input {...props} className={`h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3.5 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-slate-400 focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.14)] ${className}`} />;
}

function StatTile({ icon: Icon, label, value, unit, accent = 'orange', detail }: { icon: LucideIcon; label: string; value: string; unit?: string; accent?: 'orange' | 'lime' | 'ink' | 'blue'; detail?: string }) {
  const accentClass = { orange: 'bg-[#ffe0d3] text-[#da5a31]', lime: 'bg-[#e6edc4] text-[#5b6f2d]', ink: 'bg-[#dfe5eb] text-[#344354]', blue: 'bg-[#d8e8e7] text-[#367271]' }[accent];
  return (
    <div data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`} className="group rounded-2xl border border-[#dfd9cc] bg-[hsl(var(--card))] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[#c7bfb0]">
      <div className="mb-4 flex items-center justify-between">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${accentClass}`}><Icon size={16} strokeWidth={2.2} /></span>
        {detail && <span className="text-[11px] font-medium text-slate-500">{detail}</span>}
      </div>
      <div className="flex items-end gap-1.5">
        <strong className="font-mono text-[25px] leading-none tracking-[-.08em] text-[#222a39]">{value}</strong>
        {unit && <span className="pb-0.5 text-xs font-medium text-slate-500">{unit}</span>}
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

function EmptyState({ onLoadDemo }: { onLoadDemo: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[22px] border border-dashed border-[#cfc7b8] bg-[#f7f3ea] px-6 py-16 text-center">
      <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[#e6edc4] text-[#61752d]"><CarFront size={25} /></span>
      <h3 className="font-display text-xl font-bold tracking-[-.03em] text-[#222a39]">Your road log is quiet</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Add a ride above to see the useful bits: economy, moving pace, and the time traffic borrowed from you.</p>
      <button data-testid="button-load-demo-empty" onClick={onLoadDemo} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-[#222a39] px-4 text-sm font-semibold text-[#faf7ef] transition hover:-translate-y-0.5 hover:bg-[#303b4c]"><Sparkles size={15} /> Load a few demo rides</button>
    </div>
  );
}

function TrendChart({ rides }: { rides: Ride[] }) {
  const points = [...rides].sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const max = Math.max(...points.map((ride) => ride.distanceKm), 1);
  if (!points.length) return <div className="flex h-48 items-center justify-center text-sm text-slate-500">Your distance trend will appear after the first ride.</div>;
  return (
    <div className="relative mt-7 h-52">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between border-b border-dashed border-[#ddd7cb] pb-2 text-[10px] font-medium text-slate-400"><span>{Math.round(max)} km</span><span>distance per ride</span></div>
      <div className="absolute inset-x-0 bottom-7 top-8 flex items-end justify-between gap-2">
        {points.map((ride, index) => {
          const height = Math.max((ride.distanceKm / max) * 100, 8);
          const isLast = index === points.length - 1;
          return (
            <div key={ride.id} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
              <div className="relative w-full max-w-12">
                <div className={`absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-[#222a39] px-1.5 py-1 text-[10px] font-bold text-[#faf7ef] opacity-0 transition group-hover:opacity-100 ${isLast ? 'opacity-100' : ''}`}>{formatNumber(ride.distanceKm)} km</div>
                <div style={{ height: `${height}%` }} className={`w-full rounded-t-lg transition duration-500 group-hover:brightness-110 ${isLast ? 'bg-[#e66d43]' : 'bg-[#b7c67e]'}`} />
              </div>
              <span className="max-w-14 truncate text-[10px] text-slate-500">{new Date(`${ride.date}T12:00:00`).toLocaleDateString('en', { weekday: 'short' })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RideRow({ ride, previous, onEdit, onDelete }: { ride: Ride; previous?: Ride; onEdit: (ride: Ride) => void; onDelete: (ride: Ride) => void }) {
  const delta = previous ? economy(ride) - economy(previous) : 0;
  const positive = delta >= 0;
  return (
    <div data-testid={`row-ride-${ride.id}`} className="group grid grid-cols-[1fr_auto] gap-3 border-b border-[#e4ded3] py-4 last:border-0 sm:grid-cols-[1.2fr_.85fr_.7fr_.75fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#e9e4d9] text-[#6e716e]"><MapPin size={14} /></span>
          <div className="min-w-0"><p className="truncate text-sm font-bold text-[#303746]">{ride.label || 'Untitled ride'}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(ride.date)}</p></div>
        </div>
      </div>
      <div className="text-right sm:text-left"><p className="font-mono text-sm font-bold text-[#303746]">{formatNumber(ride.distanceKm)} <span className="text-[10px] font-normal text-slate-500">km</span></p><p className="mt-0.5 text-[11px] text-slate-500">{ride.durationMinutes} min total</p></div>
      <div className="hidden sm:block"><p className="font-mono text-sm font-bold text-[#303746]">{formatNumber(economy(ride))}</p><p className="mt-0.5 text-[11px] text-slate-500">km per litre</p></div>
      <div className="hidden sm:block"><p className="font-mono text-sm font-bold text-[#303746]">{money(cost(ride))}</p><p className="mt-0.5 text-[11px] text-slate-500">fuel cost</p></div>
      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
        {previous ? <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${positive ? 'text-[#63772f]' : 'text-[#c85538]'}`}>{positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(delta).toFixed(1)} km/L</span> : <span className="text-[11px] text-slate-400">first logged</span>}
        <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
          <button data-testid={`button-edit-ride-${ride.id}`} onClick={() => onEdit(ride)} aria-label={`Edit ${ride.label}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-[#e9e4d9] hover:text-[#222a39]"><Pencil size={14} /></button>
          <button data-testid={`button-delete-ride-${ride.id}`} onClick={() => onDelete(ride)} aria-label={`Delete ${ride.label}`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-[#f8d9d0] hover:text-[#b8462f]"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const [rides, setRides] = useState<Ride[]>(readRides);
  const [form, setForm] = useState<RideForm>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
  }, [rides]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const ordered = useMemo(() => sortNewest(rides), [rides]);
  const filtered = useMemo(() => ordered.filter((ride) => `${ride.label} ${ride.notes}`.toLowerCase().includes(query.toLowerCase())), [ordered, query]);
  const latest = ordered[0];
  const previous = ordered[1];
  const totals = useMemo(() => ({
    distance: rides.reduce((sum, ride) => sum + ride.distanceKm, 0),
    fuel: rides.reduce((sum, ride) => sum + ride.fuelLitres, 0),
    cost: rides.reduce((sum, ride) => sum + cost(ride), 0),
    traffic: rides.reduce((sum, ride) => sum + ride.trafficWaitMinutes, 0),
  }), [rides]);
  const averageEconomy = totals.fuel ? totals.distance / totals.fuel : 0;

  const updateForm = (key: keyof RideForm, value: string) => {
    setForm((current) => ({ ...current, [key]: ['distanceKm', 'fuelLitres', 'durationMinutes', 'trafficWaitMinutes', 'averageSpeedKmh', 'topSpeedKmh', 'fuelPricePerLitre'].includes(key) ? Number(value) : value }));
  };

  const submitRide = (event: FormEvent) => {
    event.preventDefault();
    if (!form.label.trim() || form.distanceKm <= 0 || form.durationMinutes <= 0) {
      setNotice('Add a route, distance, and duration to log this ride.');
      return;
    }
    const safeRide: Ride = { ...form, label: form.label.trim(), id: editingId ?? `ride-${Date.now()}` };
    setRides((current) => editingId ? current.map((ride) => ride.id === editingId ? safeRide : ride) : [safeRide, ...current]);
    setForm(initialForm());
    setEditingId(null);
    setNotice(editingId ? 'Ride updated in your log.' : 'Ride saved. Nice drive.');
  };

  const editRide = (ride: Ride) => {
    setEditingId(ride.id);
    setForm({ date: ride.date, label: ride.label, distanceKm: ride.distanceKm, fuelLitres: ride.fuelLitres, durationMinutes: ride.durationMinutes, trafficWaitMinutes: ride.trafficWaitMinutes, averageSpeedKmh: ride.averageSpeedKmh, topSpeedKmh: ride.topSpeedKmh, fuelPricePerLitre: ride.fuelPricePerLitre, notes: ride.notes });
    document.getElementById('ride-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const deleteRide = (ride: Ride) => {
    if (!window.confirm(`Remove “${ride.label || 'Untitled ride'}” from your road log?`)) return;
    setRides((current) => current.filter((item) => item.id !== ride.id));
    if (editingId === ride.id) { setEditingId(null); setForm(initialForm()); }
    setNotice('Ride removed.');
  };

  const resetDemo = () => {
    if (!window.confirm('Reset your road log to the five sample rides?')) return;
    setRides(seedRides);
    setNotice('Demo rides restored.');
  };

  const clearForm = () => { setForm(initialForm()); setEditingId(null); setNotice('Form cleared.'); };

  return (
    <div className="noise min-h-[100dvh] bg-[#f1ede4] text-[#222a39]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1600px]">
        <aside className="instrument-grid hidden w-[238px] shrink-0 flex-col bg-[#222a39] px-5 py-6 text-[#f7f3ea] lg:flex">
          <div className="flex items-center gap-3 px-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e66d43] text-[#222a39]"><Gauge size={21} strokeWidth={2.5} /></span>
            <div><p className="text-sm font-bold tracking-[-.02em]">Ride Analyzer</p><p className="mt-0.5 text-[10px] uppercase tracking-[.16em] text-[#abb5b9]">private road log</p></div>
          </div>
          <div className="mt-14">
            <p className="px-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#8e9aa1]">Your instrument</p>
            <div className="mt-3 rounded-xl bg-[#313c4d] px-3 py-3.5 text-sm font-semibold text-[#f7f3ea]"><span className="mr-2 text-[#e66d43]">●</span> Overview <ChevronRight className="float-right mt-0.5 text-[#8e9aa1]" size={15} /></div>
          </div>
          <div className="mt-auto rounded-2xl border border-[#3d4856] bg-[#2c3748] p-4">
            <div className="flex items-center gap-2 text-[#bdcb88]"><CircleDot size={15} className="pulse-dot" /><span className="text-xs font-bold">Local only</span></div>
            <p className="mt-2 text-[11px] leading-5 text-[#9da8ae]">Your rides stay in this browser. No account, no cloud, no noise.</p>
          </div>
          <p className="mt-5 px-2 text-[10px] text-[#697782]">v1.0 · made for the drive home</p>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-[#ded8cc] bg-[#f1ede4]/90 px-5 py-4 backdrop-blur-md sm:px-8 lg:px-12">
            <div className="flex items-center gap-3 lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e66d43] text-[#222a39]"><Gauge size={18} /></span><span className="text-sm font-bold">Ride Analyzer</span></div>
            <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex"><span className="h-2 w-2 rounded-full bg-[#9fb46c]" /> All systems ready <span className="mx-1 text-[#c5bcad]">/</span> Dashboard</div>
            <div className="ml-auto flex items-center gap-3"><span className="hidden text-xs text-slate-500 sm:inline">Data lives on this device</span><button data-testid="button-reset-demo" onClick={resetDemo} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8d0c3] bg-[#f7f3ea] px-3 text-xs font-bold text-[#59616b] transition hover:border-[#bfb5a6] hover:text-[#222a39]"><RotateCcw size={13} /> Reset demo</button></div>
          </header>

          <div className="px-5 pb-14 pt-7 sm:px-8 lg:px-12 lg:pt-10">
            <section className="animate-rise flex flex-col justify-between gap-6 border-b border-[#ddd6c9] pb-8 sm:flex-row sm:items-end">
              <div><p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#db6742]"><span className="h-1.5 w-1.5 rounded-full bg-[#db6742]" /> After the drive</p><h1 className="max-w-2xl text-[clamp(2.1rem,5vw,4.4rem)] font-bold leading-[.94] tracking-[-.075em] text-[#222a39]">Make every<br /><span className="text-[#db6742]">kilometre count.</span></h1><p className="mt-5 max-w-lg text-sm leading-6 text-slate-500">A private, low-friction way to turn ordinary journeys into a better feel for your car.</p></div>
              <div className="w-full max-w-[270px] rounded-2xl bg-[#e5ecc5] p-4 text-[#4e6127] sm:mb-1"><div className="flex items-start justify-between"><span className="text-[10px] font-bold uppercase tracking-[.16em]">Your road so far</span><TrendingUp size={17} /></div><p className="mt-4 font-mono text-3xl font-bold tracking-[-.08em]">{formatNumber(totals.distance)} <span className="text-sm font-normal tracking-normal">km</span></p><p className="mt-1 text-xs text-[#6e7d43]">{rides.length ? `${rides.length} ${rides.length === 1 ? 'ride' : 'rides'} logged` : 'No rides logged yet'}</p></div>
            </section>

            <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
              <form id="ride-form" onSubmit={submitRide} className="animate-rise stagger-1 rounded-[22px] border border-[#ded7ca] bg-[#faf7ef] p-5 shadow-[0_14px_40px_rgba(44,42,34,.05)] sm:p-6">
                <div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f8d9cc] text-[#cc5b38]"><Plus size={17} /></span><h2 className="text-lg font-bold tracking-[-.04em]">{editingId ? 'Edit this ride' : 'Log a ride'}</h2></div><p className="mt-1.5 pl-10 text-xs text-slate-500">{editingId ? 'Tweak the details and save your update.' : 'The good stuff starts with the basics.'}</p></div>{editingId && <button data-testid="button-cancel-edit" type="button" onClick={clearForm} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-[#eee7db] hover:text-[#222a39]"><X size={16} /></button>}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Route or label" wide><Input data-testid="input-route" value={form.label} onChange={(event) => updateForm('label', event.target.value)} placeholder="e.g. Home → studio" /></Field>
                  <Field label="Date"><div className="relative"><CalendarDays size={15} className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" /><Input data-testid="input-date" type="date" className="pl-10" value={form.date} onChange={(event) => updateForm('date', event.target.value)} /></div></Field>
                  <Field label="Distance" suffix="km"><Input data-testid="input-distance" type="number" min="0" step="0.1" value={form.distanceKm || ''} onChange={(event) => updateForm('distanceKm', event.target.value)} placeholder="0.0" /></Field>
                  <Field label="Fuel used" suffix="litres"><Input data-testid="input-fuel" type="number" min="0" step="0.01" value={form.fuelLitres || ''} onChange={(event) => updateForm('fuelLitres', event.target.value)} placeholder="0.00" /></Field>
                  <Field label="Total duration" suffix="minutes"><Input data-testid="input-duration" type="number" min="0" step="1" value={form.durationMinutes || ''} onChange={(event) => updateForm('durationMinutes', event.target.value)} placeholder="0" /></Field>
                  <Field label="Traffic wait" suffix="minutes"><Input data-testid="input-traffic" type="number" min="0" step="1" value={form.trafficWaitMinutes || ''} onChange={(event) => updateForm('trafficWaitMinutes', event.target.value)} placeholder="0" /></Field>
                </div>
                <button data-testid="button-toggle-advanced" type="button" onClick={() => setShowAdvanced((current) => !current)} className="mt-5 flex items-center gap-2 text-xs font-bold text-[#6c756f] transition hover:text-[#db6742]"><SlidersHorizontal size={14} /> {showAdvanced ? 'Hide extra details' : 'Add speed, price & notes'}<ChevronRight size={13} className={`transition ${showAdvanced ? 'rotate-90' : ''}`} /></button>
                {showAdvanced && <div className="mt-4 grid animate-rise gap-4 border-t border-[#e6dfd4] pt-4 sm:grid-cols-3"><Field label="Average speed" suffix="km/h"><Input data-testid="input-average-speed" type="number" min="0" step="0.1" value={form.averageSpeedKmh || ''} onChange={(event) => updateForm('averageSpeedKmh', event.target.value)} placeholder="optional" /></Field><Field label="Top speed" suffix="km/h"><Input data-testid="input-top-speed" type="number" min="0" step="1" value={form.topSpeedKmh || ''} onChange={(event) => updateForm('topSpeedKmh', event.target.value)} placeholder="optional" /></Field><Field label="Fuel price" suffix="per litre"><Input data-testid="input-fuel-price" type="number" min="0" step="0.01" value={form.fuelPricePerLitre || ''} onChange={(event) => updateForm('fuelPricePerLitre', event.target.value)} /></Field><Field label="Notes" wide><textarea data-testid="input-notes" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="Anything worth remembering?" className="min-h-[76px] w-full resize-y rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3.5 py-3 text-sm text-[hsl(var(--foreground))] outline-none transition placeholder:text-slate-400 focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary)/.14)]" /></Field></div>}
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button data-testid="button-clear-form" type="button" onClick={clearForm} className="h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 transition hover:bg-[#eee7db] hover:text-[#222a39]">Clear</button><button data-testid="button-save-ride" type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#e66d43] px-5 text-sm font-bold text-[#222a39] shadow-[0_5px_0_#bb5232] transition hover:-translate-y-0.5 hover:bg-[#ee7950] active:translate-y-0 active:shadow-none"><Check size={16} strokeWidth={2.5} /> {editingId ? 'Save changes' : 'Save ride'}</button></div>
              </form>

              <div className="animate-rise stagger-2 instrument-grid relative overflow-hidden rounded-[22px] bg-[#283344] p-5 text-[#f7f3ea] sm:p-6">
                <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full border-[20px] border-[#3c485a] opacity-50" /><div className="absolute -right-7 -top-7 h-26 w-26 rounded-full border border-[#526074] opacity-60" />
                <div className="relative"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#aab4b5]">Live readout</p><h2 className="mt-2 text-xl font-bold tracking-[-.04em]">Last ride, decoded</h2></div><span className="rounded-full border border-[#526073] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#baca88]">{latest ? 'recent signal' : 'waiting'}</span></div>
                  {latest ? <><div className="mt-8 flex items-end gap-3"><span className="font-mono text-[clamp(3rem,6vw,4.5rem)] font-bold leading-none tracking-[-.1em] text-[#f6bd80]">{formatNumber(economy(latest))}</span><span className="pb-1.5 text-sm text-[#b6bec1]">km/L<br /><span className="text-xs text-[#89959c]">fuel economy</span></span></div><div className="mt-8 grid grid-cols-2 gap-3 border-t border-[#465263] pt-4"><div><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Moving pace</p><p className="mt-1 font-mono text-lg font-bold">{formatNumber(movingSpeed(latest))} <span className="text-xs font-normal text-[#89959c]">km/h</span></p></div><div><p className="text-[10px] uppercase tracking-[.14em] text-[#89959c]">Traffic tax</p><p className="mt-1 font-mono text-lg font-bold">{Math.round(trafficPercent(latest))}<span className="text-xs font-normal text-[#89959c]">%</span></p></div></div><p className="mt-6 flex items-center gap-2 text-xs text-[#aab4b5]"><Info size={13} /> {latest.label} · {formatDate(latest.date)}</p></> : <div className="flex h-[275px] flex-col items-center justify-center text-center"><Gauge size={32} className="mb-3 text-[#748091]" /><p className="text-sm font-semibold text-[#dce1df]">Your next ride will light this up.</p><p className="mt-1 max-w-[220px] text-xs leading-5 text-[#89959c]">Log the basics and we’ll calculate the useful bits.</p></div>}
                </div>
              </div>
            </section>

            <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="animate-rise stagger-2"><StatTile icon={RouteIcon} label="Total distance" value={formatNumber(totals.distance)} unit="km" detail={`${rides.length} rides`} accent="orange" /></div>
              <div className="animate-rise stagger-3"><StatTile icon={Fuel} label="Average economy" value={formatNumber(averageEconomy)} unit="km/L" detail="all logged rides" accent="lime" /></div>
              <div className="animate-rise stagger-4"><StatTile icon={Clock3} label="Traffic wait" value={formatNumber(totals.traffic, 0)} unit="min" detail="time parked" accent="blue" /></div>
              <div className="animate-rise stagger-5"><StatTile icon={Database} label="Fuel spend" value={money(totals.cost)} detail={`${formatNumber(totals.fuel, 1)} litres`} accent="ink" /></div>
            </section>

            <section className="mt-8 grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
              <div className="animate-rise rounded-[22px] border border-[#ded7ca] bg-[#faf7ef] p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#db6742]">Pattern finder</p><h2 className="mt-2 text-xl font-bold tracking-[-.05em]">Distance, at a glance</h2><p className="mt-1 text-xs text-slate-500">Your last seven rides, oldest to newest.</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e9e4d9] text-[#68716c]"><TrendingUp size={17} /></span></div><TrendChart rides={rides} /></div>
              <div className="animate-rise stagger-1 rounded-[22px] bg-[#e7d6c5] p-5 sm:p-6"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#9b5e44]">A small insight</p><h2 className="mt-3 max-w-xs text-2xl font-bold leading-[1.03] tracking-[-.06em] text-[#46352f]">{latest ? latest.trafficWaitMinutes <= 5 ? 'That was a clean run.' : 'Traffic had a say today.' : 'The road is yours to read.'}</h2><p className="mt-4 text-sm leading-6 text-[#72584c]">{latest ? `On ${latest.label || 'your last ride'}, ${latest.trafficWaitMinutes} minutes were spent waiting. Your moving pace was ${formatNumber(movingSpeed(latest))} km/h.` : 'Save a ride and Ride Analyzer will surface the little patterns worth noticing.'}</p><div className="mt-7 flex items-center gap-2 text-xs font-bold text-[#9b5e44]"><Timer size={15} /> {latest ? `${Math.round(trafficPercent(latest))}% of the ride was waiting` : 'Ready when you are'}</div></div>
            </section>

            <section className="mt-8 animate-rise rounded-[22px] border border-[#ded7ca] bg-[#faf7ef] p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#db6742]">Road log</p><h2 className="mt-2 text-xl font-bold tracking-[-.05em]">Recent rides</h2><p className="mt-1 text-xs text-slate-500">A quiet record of where the kilometres went.</p></div><div className="relative w-full sm:w-56"><Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400" /><input data-testid="input-search-rides" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your log" className="h-10 w-full rounded-xl border border-[#dcd4c8] bg-[#f4f0e7] pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-[#db6742] focus:ring-4 focus:ring-[#db6742]/10" /></div></div>
              {rides.length ? <>{filtered.length ? <div className="mt-5"><div className="mb-1 hidden grid-cols-[1.2fr_.85fr_.7fr_.75fr_auto] gap-3 border-b border-[#e4ded3] pb-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400 sm:grid"><span>Ride</span><span>Distance</span><span>Economy</span><span>Cost</span><span /></div>{filtered.map((ride, index) => <RideRow key={ride.id} ride={ride} previous={ordered[index + 1]} onEdit={editRide} onDelete={deleteRide} />)}</div> : <div className="mt-6 rounded-xl bg-[#f1ede4] px-4 py-8 text-center text-sm text-slate-500">No rides match “{query}”. <button data-testid="button-clear-search" onClick={() => setQuery('')} className="font-bold text-[#c85c3a] hover:underline">Clear search</button></div>}</> : <div className="mt-5"><EmptyState onLoadDemo={() => { setRides(seedRides); setNotice('Demo rides loaded.'); }} /></div>}
              {rides.length > 0 && <div className="mt-5 flex flex-col justify-between gap-3 border-t border-[#e4ded3] pt-4 text-xs text-slate-500 sm:flex-row sm:items-center"><span>{filtered.length} of {rides.length} {rides.length === 1 ? 'ride' : 'rides'} shown</span><button data-testid="button-clear-all-rides" onClick={() => { if (window.confirm('Delete every ride from this browser?')) { setRides([]); setNotice('Road log cleared.'); } }} className="inline-flex items-center gap-1.5 font-bold text-[#b9573b] transition hover:text-[#8f3c27]"><Trash2 size={13} /> Clear all rides</button></div>}
            </section>
            <footer className="flex flex-col gap-2 px-1 pb-2 pt-8 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#9fb46c]" /> Stored locally in your browser</span><span>Ride Analyzer · for the curious driver</span></footer>
          </div>
        </main>
      </div>
      {notice && <div data-testid="status-notice" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#222a39] px-4 py-3 text-sm font-semibold text-[#f7f3ea] shadow-[0_10px_30px_rgba(34,42,57,.25)] animate-rise"><Check size={16} className="text-[#bdcb88]" />{notice}</div>}
    </div>
  );
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