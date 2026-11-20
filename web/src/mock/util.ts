// Shared helpers for the /api/v2 mock modules. Mock only: loaded through mock.ts behind MOCK.
import { lifeYmd, localInputToIso } from '../time';

export type Res = { status: number; body: unknown };
/** One request, with `p` relative to /api/v2 (e.g. "/tasks/abc/done"). */
export type Ctx = { method: string; p: string; qp: URLSearchParams; b: Record<string, unknown>; route: string };
export type Handler = (c: Ctx) => Res | null;

export const ok = (body: unknown): Res => ({ status: 200, body });
export const created = (body: unknown): Res => ({ status: 201, body });
export const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): Res => ({
  status,
  body: { error, message, ...extra },
});
export const notFound = (what: string): Res => fail(404, 'not_found', `${what} not found.`);
export const bad = (message: string): Res => fail(400, 'bad_request', message);

/** Match `route` ("POST /tasks/x/done") against a pattern; returns decoded groups or null. */
export function match(route: string, re: RegExp): string[] | null {
  const m = re.exec(route);
  return m ? (m.slice(1).map((s) => (s === undefined ? s : decodeURIComponent(s))) as string[]) : null;
}

export const iso = (ms = Date.now()) => new Date(ms).toISOString();
/**
 * Dry runs: open the mock with `?fake=2031-02-10` to make every mock "today" that day (kept for the tab in
 * sessionStorage; `?fake=off` clears it). Only the mock moves: the real API always uses the real clock.
 */
export function fakeDay(): string | null {
  try {
    const v = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fake');
    if (v === 'off') sessionStorage.removeItem('mock.fake');
    else if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) sessionStorage.setItem('mock.fake', v);
    const s = sessionStorage.getItem('mock.fake');
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}
export const today = () => fakeDay() ?? lifeYmd();
/** The mock's current mode (set by mockV2 on each request), for handlers that behave differently by mode. */
let currentMode = 'Normal';
export const setMockMode = (m: string) => {
  currentMode = m;
};
export const mockMode = () => currentMode;
/** Calendar-day arithmetic on YYYY-MM-DD (noon UTC, so no timezone can shift the date). */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** Monday of the week, as on the server (weekStartOf). */
export const weekStart = (day: string) => addDays(day, -((dow(day) + 6) % 7));
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
/** An ISO instant at local wall time (the app's timezone) on a day. */
export const at = (day: string, hhmm: string) => new Date(localInputToIso(`${day}T${hhmm}`) ?? `${day}T${hhmm}:00Z`).toISOString();

let seq = 0;
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`;
/** The client id from the body when it sent one (idempotent creates), else a fresh id. */
export const idOf = (b: Record<string, unknown>, prefix: string) => (typeof b.id === 'string' && b.id ? b.id : uid(prefix));

export const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v === undefined || v === null ? d : String(v));
export const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
export const optNum = (v: unknown): number | null => {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};
export const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** EUR per USD used by the mock: a round demo rate, marked as an estimate (close to the API fallback). */
export const EUR_PER_USD = 0.92;
/** USD per unit, as the API stores rates (to_usd). */
export const RATES_TO_USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, JPY: 0.0067, CHF: 1.13 };
export const toUsd = (amount: number, currency: string) => round(amount * (RATES_TO_USD[currency] ?? 1), 2);
