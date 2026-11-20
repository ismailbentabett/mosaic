// Time helpers in the owner's timezone. The zone comes from MOSAIC_TZ (or TZ) and falls back to UTC.
// Any IANA zone works, DST included: wall times are turned into instants with zonedIso / zonedMs.

const validTz = (z: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };
/** The timezone every "today", "hh:mm" and life-day is read in (IANA name, default UTC). */
export const TZ: string = [process.env.MOSAIC_TZ, process.env.TZ]
  .map((z) => z?.trim().replace(/^:/, ''))
  .find((z): z is string => !!z && validTz(z)) ?? 'UTC';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', hourCycle: 'h23',
});
const parts = (d: Date) => {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  return o;
};

/** Minutes TZ is ahead of UTC at an instant (e.g. 60 for UTC+1, -300 for New York in winter). */
export const offsetMinutes = (d: Date = new Date()) => {
  const p = parts(d);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((wall - Math.floor(d.getTime() / 1000) * 1000) / 60000);
};
const fmtOffset = (min: number) => {
  const s = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
/** "+HH:MM" offset of TZ at an instant. */
export const offsetAt = (d: Date = new Date()) => fmtOffset(offsetMinutes(d));
/**
 * Offset of TZ right now. Kept for callers that build `${day}T${hm}:00${OFFSET}`; prefer zonedIso(day, hm),
 * which stays right across DST changes.
 */
export const OFFSET = offsetAt();

/** Epoch ms of a wall-clock time (YYYY-MM-DD + HH:MM[:SS]) in TZ. */
export const zonedMs = (day: string, hm = '00:00') => {
  const t = hm.length === 5 ? `${hm}:00` : hm;
  const guess = Date.parse(`${day}T${t}Z`);
  let ms = guess - offsetMinutes(new Date(guess)) * 60000;
  const again = guess - offsetMinutes(new Date(ms)) * 60000; // second pass settles DST edges
  if (again !== ms) ms = again;
  return ms;
};
/** ISO 8601 with TZ's offset for a wall-clock time in TZ: zonedIso('2026-11-11', '09:30'). */
export const zonedIso = (day: string, hm = '00:00') => {
  const ms = zonedMs(day, hm);
  const t = hm.length === 5 ? `${hm}:00` : hm;
  return `${day}T${t}${offsetAt(new Date(ms))}`;
};
/** A Date for a wall-clock time in TZ. */
export const zonedDate = (day: string, hm = '00:00') => new Date(zonedMs(day, hm));

// Calendar-date arithmetic needs no zone: noon UTC of the date is the same calendar day everywhere it is used here.
const noonUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);
const ymdUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** YYYY-MM-DD in TZ. */
export const dateOf = (d: Date = new Date()) => { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; };
/** HH:MM in TZ. */
export const hhmm = (d: Date = new Date()) => { const p = parts(d); return `${p.hour}:${p.minute}`; };
/** Weekday name in English (Monday...) of a YYYY-MM-DD. */
export const weekdayOf = (date: string) => WEEKDAYS[new Date(noonUtc(date)).getUTCDay()];
/** 0=Sun..6=Sat for a YYYY-MM-DD. */
export const dowOf = (date: string) => new Date(noonUtc(date)).getUTCDay();
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = noonUtc(s);
  return !Number.isNaN(ms) && ymdUtc(ms) === s; // impossible dates (2026-13-01) are false, never a throw
};
export const addDays = (date: string, n: number) => ymdUtc(noonUtc(date) + n * 86400000);
export const dayStart = (date: string) => zonedIso(date, '00:00');
export const dayEnd = (date: string) => zonedIso(addDays(date, 1), '00:00');
/** ISO 8601 with TZ's offset for a Date. */
export const iso = (d: Date = new Date()) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offsetAt(d)}`;
};
export const today = () => dateOf();
export const tomorrow = () => addDays(dateOf(), 1);

/** Life-day: the day rolls at startHour (default 04:00) in TZ. A 01:00 snack belongs to the previous day. */
export const lifeDay = (d: Date = new Date(), startHour = 4) => dateOf(new Date(d.getTime() - startHour * 3600000));
export const lifeToday = () => lifeDay();
/** Monday of the ISO week containing date. */
export const weekStartOf = (date: string) => addDays(date, -((dowOf(date) + 6) % 7));
/** Whole days from a to b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((noonUtc(b) - noonUtc(a)) / 86400000);
