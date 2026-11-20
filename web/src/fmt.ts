// One place for every number, unit, date and time the app shows.
// Rules: missing values render as an em dash, negatives use a real minus sign (U+2212),
// signed deltas always show their sign, units are separated by a thin no-break space,
// and all dates/times use the app's one timezone (TZ in ./time).
import { TZ, dateAtNoon, hm, lifeYmd } from './time';

export const DASH = '—';
/** A bare clock string from the API (HH:MM or HH:MM:SS) as HH:MM. */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : DASH);
const MINUS = '−';
const NB = ' '; // narrow no-break space between number and unit

type N = number | null | undefined;
const ok = (n: N): n is number => typeof n === 'number' && Number.isFinite(n);

const nf = new Map<string, Intl.NumberFormat>();
function fmt(n: number, min: number, max: number, extra: Intl.NumberFormatOptions = {}): string {
  const key = `${min}|${max}|${JSON.stringify(extra)}`;
  let f = nf.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra });
    nf.set(key, f);
  }
  // Avoid "-0" after rounding.
  const out = f.format(n);
  return out.replace(/^-(?=0(\.0+)?$)/, '').replace(/^-/, MINUS);
}

/** 1,234 · 1,234.5 (max digits, trailing zeros dropped). */
export const num = (n: N, digits = 0): string => (ok(n) ? fmt(n, 0, digits) : DASH);
/** Fixed decimals: 78.30. */
export const fixed = (n: N, digits = 1): string => (ok(n) ? fmt(n, digits, digits) : DASH);
/** Signed delta: +0.4, −1.2, 0. */
export function signed(n: N, digits = 1): string {
  if (!ok(n)) return DASH;
  const s = fmt(Math.abs(n), 0, digits);
  if (s === fmt(0, 0, digits)) return s;
  return (n > 0 ? '+' : MINUS) + s;
}
/** 1.2k, 34k, 1.1M for tight spots. */
export const compact = (n: N): string => (ok(n) ? fmt(n, 0, 1, { notation: 'compact' }) : DASH);
/** Share 0..1 → "42%". */
export const pct = (share: N, digits = 0): string => (ok(share) ? fmt(share * 100, 0, digits) + '%' : DASH);

/** Plural label: plural(3, 'set') → "3 sets"; plural(1, 'entry', 'entries') → "1 entry". */
export function plural(n: number, one: string, many = one + 's'): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

// ---- Money ----
const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
/** ISO 4217 codes shown without minor units. */
const NO_DECIMALS = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF']);
/** $1,234 · $12.50 · −$40. Cents show only when the value has them (or digits is forced). */
export function usd(n: N, digits?: number): string {
  if (!ok(n)) return DASH;
  const d = digits ?? (Math.abs(n) < 100 && !Number.isInteger(Math.round(n * 100) / 100) ? 2 : 0);
  const body = fmt(Math.abs(n), d, d);
  return (n < 0 ? MINUS : '') + '$' + body;
}
/** Signed money delta: +$120, −$40. */
export function usdSigned(n: N, digits?: number): string {
  if (!ok(n)) return DASH;
  if (Math.round(n * 100) === 0) return '$0';
  return (n > 0 ? '+' : '') + usd(n, digits);
}
/** Any ISO currency: $12.50 · €8 · £3 · 1,200 CHF. */
export function money(amount: N, currency = 'USD'): string {
  if (!ok(amount)) return DASH;
  const c = currency.toUpperCase();
  if (c === 'USD') return usd(amount);
  const sym = SYMBOL[c];
  const d = Number.isInteger(amount) || NO_DECIMALS.has(c) ? 0 : 2;
  const body = fmt(Math.abs(amount), d, d);
  const sign = amount < 0 ? MINUS : '';
  if (sym) return `${sign}${sym}${body}`;
  return `${sign}${body}${NB}${c}`;
}

// ---- Units ----
export const kg = (n: N, digits = 1): string => (ok(n) ? `${fmt(n, digits, digits)}${NB}kg` : DASH);
export const kgSigned = (n: N, digits = 1): string => (ok(n) ? `${signed(n, digits)}${NB}kg` : DASH);
/** Weight lifted: 62.5 kg, 60 kg (no forced decimal). */
export const load = (n: N): string => (ok(n) ? `${fmt(n, 0, 2)}${NB}kg` : DASH);
export const kcal = (n: N): string => (ok(n) ? `${fmt(Math.round(n), 0, 0)}${NB}kcal` : DASH);
export const grams = (n: N, digits = 0): string => (ok(n) ? `${fmt(n, 0, digits)}${NB}g` : DASH);
export const cm = (n: N): string => (ok(n) ? `${fmt(n, 0, 1)}${NB}cm` : DASH);
/** 250 ml · 1.5 L */
export function ml(n: N): string {
  if (!ok(n)) return DASH;
  return Math.abs(n) >= 1000 ? `${fmt(n / 1000, 0, 2)}${NB}L` : `${fmt(n, 0, 0)}${NB}ml`;
}
/** Value in its own unit, for body metrics and goals. */
export function unit(n: N, u: string | null | undefined, digits = 1): string {
  if (!ok(n)) return DASH;
  const k = (u ?? '').toLowerCase();
  if (k === 'kg') return kg(n, digits);
  if (k === 'cm') return cm(n);
  if (k === 'usd' || k === '$') return usd(n);
  if (k === '€') return money(n, 'EUR');
  if (k === '£') return money(n, 'GBP');
  if (['eur', 'gbp', 'cad', 'aud', 'jpy', 'chf'].includes(k)) return money(n, k.toUpperCase());
  if (k === '%') return fmt(n, 0, digits) + '%';
  return u ? `${fmt(n, 0, digits)}${NB}${u}` : fmt(n, 0, digits);
}

// ---- Durations ----
/** 45 min · 1 h · 1 h 20 min. */
export function minutes(n: N): string {
  if (!ok(n)) return DASH;
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m}${NB}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}${NB}h ${r}${NB}min` : `${h}${NB}h`;
}
/** Compact duration for meta lines: 45m · 1h 20m. */
export function mins(n: N): string {
  if (!ok(n)) return DASH;
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
/** Countdown clock: 2:05 · 1:02:05. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
/** Seconds as rest length: 90 s · 2 min · 2 min 30 s. */
export function secs(n: N): string {
  if (!ok(n)) return DASH;
  const s = Math.round(n);
  if (s < 60) return `${s}${NB}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}${NB}min ${s % 60}${NB}s` : `${m}${NB}min`;
}
/** 27.7 weeks → "27 weeks" ; < 1 → "under a week". */
export function weeks(n: N): string {
  if (!ok(n)) return DASH;
  if (n < 1) return 'under a week';
  const w = Math.floor(n);
  return `${w} ${w === 1 ? 'week' : 'weeks'}`;
}

// ---- Dates ----
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
const weekdayF = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: TZ });
const dmF = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
const dmyF = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const wdmF = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const longF = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const narrowF = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: TZ });

/**
 * A YYYY-MM-DD day, relative to today and without judgement:
 * Today · Tomorrow · Yesterday · Fri (this week) · 13 Nov · 3 Feb 2031.
 */
export function day(d: string | null | undefined, today = lifeYmd()): string {
  if (!d) return DASH;
  const diff = dayDiff(d, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const at = dateAtNoon(d);
  if (diff > 1 && diff < 7) return weekdayF.format(at);
  if (d.slice(0, 4) !== today.slice(0, 4)) return dmyF.format(at);
  return dmF.format(at);
}
/** Always the full date: Wed 11 Nov. */
export const dayFull = (d: string) => wdmF.format(dateAtNoon(d));
/** Narrow weekday initial for chart labels: W. */
export const dayInitial = (d: string) => narrowF.format(dateAtNoon(d));
/** Wednesday 11 November. */
export const dayLong = (d: string) => longF.format(dateAtNoon(d));
const headF = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ });
/** Screen heading: Wednesday, 11 Nov. */
export function dayHead(d: string): string {
  const parts = headF.formatToParts(dateAtNoon(d));
  const part = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
}
/** 11 Nov – 17 Nov (same month collapses: 11–17 Nov). */
export function range(from: string, to: string): string {
  const a = dateAtNoon(from);
  const b = dateAtNoon(to);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.getUTCDate()}–${dmF.format(b)}`;
  return `${dmF.format(a)} – ${dmF.format(b)}`;
}
/** Due day + optional time: "Today 18:00", "Fri", "13 Nov 09:30". */
export function due(date: string | null, time?: string | null): string {
  if (!date) return '';
  return time ? `${day(date)} ${time.slice(0, 5)}` : day(date);
}
/** Days until a date: "in 3 days", "today", "5 days ago". */
export function until(d: string, today = lifeYmd()): string {
  const n = dayDiff(d, today);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
/** Clock time from an ISO instant: 16:30. */
export const time = (iso: string | null | undefined): string => (iso ? hm(iso) : DASH);
/** When something happened: just now · 12 min ago · today 16:30 · Yesterday 09:10 · 3 Nov 18:00. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const diff = now - Date.parse(iso);
  if (diff < 0) return time(iso);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}${NB}min ago`;
  const d = lifeYmd(iso);
  if (d === lifeYmd(now)) return `today ${hm(iso)}`;
  return `${day(d, lifeYmd(now))} ${hm(iso)}`;
}
