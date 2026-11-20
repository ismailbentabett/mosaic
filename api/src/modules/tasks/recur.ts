// Recurrence engine (local dates, one fixed zone). Pure functions, no DB.
import { addDays, dowOf, isDate, weekStartOf, daysBetween } from '../../time.ts';

export type Recur = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;          // every N units, default 1
  byday?: number[];           // weekly: 0=Sun..6=Sat
  monthday?: number;          // monthly: 1..31 (clamped to month length)
  nth?: { n: number; dow: number }; // monthly: n=1..4 or -1 (last) weekday
  from?: 'due' | 'completion';
  until?: string;             // last allowed date
  count?: number;             // total occurrences
  done_count?: number;        // occurrences completed so far
};

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ymd = (s: string) => s.split('-').map(Number) as [number, number, number];
const pad = (n: number) => String(n).padStart(2, '0');
const mk = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const monthLen = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const addMonths = (date: string, n: number, day?: number) => {
  const [y, m, d] = ymd(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return mk(ny, nm, Math.min(day ?? d, monthLen(ny, nm)));
};

const nthWeekday = (y: number, m: number, n: number, dow: number) => {
  if (n === -1) {
    const last = monthLen(y, m);
    for (let d = last; d > last - 7; d--) if (dowOf(mk(y, m, d)) === dow) return mk(y, m, d);
  }
  let count = 0;
  for (let d = 1; d <= monthLen(y, m); d++) if (dowOf(mk(y, m, d)) === dow && ++count === n) return mk(y, m, d);
  return null;
};

export const validRecur = (r: unknown): r is Recur => {
  if (!r || typeof r !== 'object') return false;
  const x = r as Recur;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(x.freq)) return false;
  if (x.interval !== undefined && (!Number.isInteger(x.interval) || x.interval < 1 || x.interval > 365)) return false;
  if (x.byday && (!Array.isArray(x.byday) || x.byday.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) return false;
  if (x.monthday !== undefined && (!Number.isInteger(x.monthday) || x.monthday < 1 || x.monthday > 31)) return false;
  if (x.until !== undefined && !isDate(x.until)) return false;
  return true;
};

/** The occurrence after `base` (exclusive). */
const step = (r: Recur, base: string): string | null => {
  const n = r.interval ?? 1;
  switch (r.freq) {
    case 'daily': return addDays(base, n);
    case 'weekly': {
      if (!r.byday?.length) return addDays(base, 7 * n);
      const w0 = weekStartOf(base);
      for (let i = 1; i <= 7 * n + 7; i++) {
        const d = addDays(base, i);
        const weeks = Math.floor(daysBetween(w0, weekStartOf(d)) / 7);
        if (weeks % n === 0 && r.byday.includes(dowOf(d))) return d;
      }
      return null;
    }
    case 'monthly': {
      if (r.nth) {
        for (let k = 0; k <= 24; k += n) {
          const [y, m] = ymd(addMonths(base, k, 1));
          const d = nthWeekday(y, m, r.nth.n, r.nth.dow);
          if (d && d > base) return d;
        }
        return null;
      }
      const day = r.monthday ?? ymd(base)[2];
      const sameMonth = addMonths(base, 0, day);
      if (sameMonth > base && n === 1 && r.monthday) return sameMonth;
      return addMonths(base, n, day);
    }
    case 'yearly': return addMonths(base, 12 * n);
  }
};

/**
 * Next due date after completing an occurrence due `due` on `completedOn`.
 * Missed occurrences collapse: from-due rules skip forward to the first date >= today.
 * Returns null when the series ended (until / count).
 */
export const nextOccurrence = (r: Recur, due: string, completedOn: string, today = completedOn): string | null => {
  if ((r.count ?? 0) > 0 && (r.done_count ?? 0) + 1 >= (r.count as number)) return null;
  let next = step(r, r.from === 'completion' ? completedOn : due);
  let guard = 0;
  while (next && r.from !== 'completion' && next < today && guard++ < 2000) next = step(r, next);
  if (!next) return null;
  if (r.until && next > r.until) return null;
  return next;
};

/** RRULE subset (task-app CSV export): FREQ, INTERVAL, BYDAY, BYMONTHDAY, UNTIL, COUNT. */
export const fromRRule = (s: string): Recur | null => {
  const body = s.replace(/^RRULE:/i, '').trim();
  if (!body) return null;
  const kv = Object.fromEntries(body.split(';').map((p) => p.split('=') as [string, string]).filter(([k, v]) => k && v));
  const freq = ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as const)[kv.FREQ?.toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'];
  if (!freq) return null;
  const r: Recur = { freq };
  if (kv.INTERVAL) r.interval = Math.max(1, Number(kv.INTERVAL) || 1);
  if (kv.BYDAY) {
    const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const parts = kv.BYDAY.split(',');
    const m = parts[0].match(/^(-?\d)([A-Z]{2})$/);
    if (freq === 'monthly' && m) r.nth = { n: Number(m[1]), dow: codes.indexOf(m[2]) };
    else r.byday = parts.map((p) => codes.indexOf(p.slice(-2))).filter((d) => d >= 0);
  }
  if (kv.BYMONTHDAY) r.monthday = Number(kv.BYMONTHDAY);
  if (kv.UNTIL) { const u = kv.UNTIL.slice(0, 8); r.until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`; }
  if (kv.COUNT) r.count = Number(kv.COUNT);
  return validRecur(r) ? r : null;
};

export const describeRecur = (r: Recur) => {
  const n = r.interval ?? 1;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let s = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  if (r.byday?.length) s = r.byday.join() === '1,2,3,4,5' ? 'every weekday' : `${s} on ${r.byday.map((d) => DAYS[d]).join(', ')}`;
  if (r.nth) s += ` on the ${r.nth.n === -1 ? 'last' : `#${r.nth.n}`} ${DAYS[r.nth.dow]}`;
  if (r.monthday) s += ` on day ${r.monthday}`;
  if (r.from === 'completion') s += ' after done';
  return s;
};
