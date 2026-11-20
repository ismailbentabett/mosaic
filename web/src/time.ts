/** The app's timezone: the browser's own IANA zone, UTC when it cannot be read. */
const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
export const TZ = browserZone();

const hmFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
const longDayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

/** "16:30" in local time. */
export const hm = (d: string | number | Date) => hmFmt.format(new Date(d));
/** "2026-11-11" in local time. */
export const ymd = (d: string | number | Date = Date.now()) => dateFmt.format(new Date(d));
/**
 * The life-day an instant belongs to: the day rolls at 04:00 local time, as on the server
 * (api/src/time.ts lifeDay). A 01:30 set or snack is still "today". Use this, not ymd(),
 * whenever "today" means the user's day.
 */
export const LIFE_DAY_START_H = 4;
export const lifeYmd = (d: string | number | Date = Date.now()) => ymd(new Date(d).getTime() - LIFE_DAY_START_H * 3600000);
/** "Wed 11 Nov" */
export const shortDay = (d: string | number | Date) => dayFmt.format(new Date(d));
export const longDay = (d: string | number | Date) => longDayFmt.format(new Date(d));

/** A YYYY-MM-DD date as noon UTC (the same calendar day in every zone from UTC-11 to UTC+11; safe for formatting the day). */
export const dateAtNoon = (date: string) => new Date(`${date}T12:00:00Z`);

export function minutesLeft(endIso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(endIso) - now) / 60000));
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** ISO → value for <input type="datetime-local"> in local time. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  return `${ymd(iso)}T${hm(iso)}`;
}

/** Offset of TZ from UTC, in minutes, at an instant (e.g. 60 for UTC+1). */
export function offsetMinutesAt(ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000);
}

/** <input type="datetime-local"> value (local wall time) → ISO with the zone's offset at that time. */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const wall = `${v.length === 16 ? v + ':00' : v}`;
  const asUtc = Date.parse(`${wall}Z`);
  if (!Number.isFinite(asUtc)) return null;
  let off = offsetMinutesAt(asUtc - offsetMinutesAt(asUtc) * 60000);
  off = offsetMinutesAt(asUtc - off * 60000);
  const a = Math.abs(off);
  const sign = off < 0 ? '-' : '+';
  return `${wall}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Due label without judgement: "Today 18:00", "Tomorrow", "Fri 13 Nov". Overdue just shows its date. */
export function dueLabel(iso: string): string {
  const today = ymd();
  const d = ymd(iso);
  const t = hm(iso);
  const time = t === '00:00' || t === '23:59' ? '' : ` ${t}`;
  if (d === today) return `Today${time}`;
  const tomorrow = ymd(Date.now() + 86400000);
  if (d === tomorrow) return `Tomorrow${time}`;
  return `${shortDay(iso)}${time}`;
}

export function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (ymd(iso) === ymd()) return `today ${hm(iso)}`;
  return `${shortDay(iso)} ${hm(iso)}`;
}

/* ---- Local wall clock in TZ. Use these, never Date#getHours / getDay, so every screen reads the same zone. ---- */
const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ });
/** Hour 0–23 in TZ. */
export const localHour = (d: string | number | Date = Date.now()) => Number(hourFmt.format(new Date(d))) % 24;
/** Minutes since midnight in TZ. */
export const localMinutes = (d: string | number | Date = Date.now()) => { const [h, m] = hm(d).split(':').map(Number); return (h % 24) * 60 + m; };
/** Weekday 0=Sun … 6=Sat of a YYYY-MM-DD date. */
export const dowOfYmd = (date: string) => dateAtNoon(date).getUTCDay();
/** Weekday 0=Sun … 6=Sat of the current life-day (rolls at 04:00 local time). */
export const lifeDow = (d: string | number | Date = Date.now()) => dowOfYmd(lifeYmd(d));
/** "HH:MM" → minutes since midnight. */
export const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
