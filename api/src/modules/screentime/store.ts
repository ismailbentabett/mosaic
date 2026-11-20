// Screen time from Android, Windows and the browser. Devices push daily per-app minutes (ActivityWatch sync
// scripts in tools/screentime/). Shown neutrally: no limits, no red, no "too much". Per-device token-free:
// one ingest token (sha256 stored in secrets.env as MOSAIC_INGEST_HASH) authorises POST /ingest/screentime.
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { secret } from '../../config.ts';
import { addDays, isDate, lifeToday } from '../../time.ts';
import { all, db, now, round, type Row } from '../util.ts';

export const DEVICE_KINDS = ['android', 'windows', 'browser', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
const DEVICE_RE = /^[a-z0-9-]{2,40}$/;
const MAX_ROWS = 2000;

export type ScreenRow = { day: string; app: string; minutes: number; kind?: string };

/** Constant-time check of a Bearer token against the stored sha256. No hash set → ingest is closed. */
export const checkIngestToken = (token: string | undefined) => {
  const want = secret('MOSAIC_INGEST_HASH');
  if (!want || !token || token.length < 20 || token.length > 200) return false;
  const got = createHash('sha256').update(token).digest('hex');
  const a = Buffer.from(got), b = Buffer.from(want.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
};

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const cleanApp = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);

/** Upsert daily minutes. Each row replaces the same (day, device, app): re-syncing a day is safe. */
export const ingestScreenTime = (device: unknown, kind: unknown, rows: unknown, source = 'activitywatch') => {
  const dev = String(device ?? '').toLowerCase();
  if (!DEVICE_RE.test(dev)) throw new AppError('bad_request', 'device: 2-40 chars, a-z 0-9 -');
  const k = String(kind ?? '') as DeviceKind;
  if (!DEVICE_KINDS.includes(k)) throw new AppError('bad_request', `kind: one of ${DEVICE_KINDS.join(', ')}`);
  if (!Array.isArray(rows)) throw new AppError('bad_request', 'rows must be an array');
  if (rows.length > MAX_ROWS) throw new AppError('bad_request', `max ${MAX_ROWS} rows per sync`);
  const src = String(source).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'activitywatch';
  const at = now();
  const stmt = db().prepare(`INSERT INTO screen_time (day, device, app, minutes, kind, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, device, app) DO UPDATE SET minutes = excluded.minutes, kind = excluded.kind, source = excluded.source, updated_at = excluded.updated_at`);
  let saved = 0, skipped = 0;
  const days = new Set<string>();
  db().exec('BEGIN');
  try {
    for (const r of rows as Row[]) {
      const day = String(r?.day ?? '');
      const app = cleanApp(r?.app);
      const min = Number(r?.minutes);
      const rk = r?.kind === 'web' || r?.kind === 'app' ? r.kind : k === 'browser' ? 'web' : 'app';
      if (!isDate(day) || !app || !Number.isFinite(min) || min < 0 || min > 1440) { skipped++; continue; }
      stmt.run(day, dev, app, round(min, 1), rk, src, at);
      days.add(day);
      saved++;
    }
    db().prepare(`INSERT INTO screen_devices (device, kind, last_sync) VALUES (?, ?, ?)
      ON CONFLICT(device) DO UPDATE SET kind = excluded.kind, last_sync = excluded.last_sync`).run(dev, k, at);
    db().exec('COMMIT');
  } catch (e) { db().exec('ROLLBACK'); throw e; }
  return { device: dev, saved, skipped, days: [...days].sort() };
};

export const listDevices = () => all<Row>('SELECT device, kind, last_sync FROM screen_devices ORDER BY device');

/** Totals for `days` life-days ending at `day`: per device, top apps, per-day totals. Neutral numbers only. */
export const screenTimeSummary = (day = lifeToday(), days = 1, top = 10) => {
  const n = Math.max(1, Math.min(90, Math.round(days)));
  const from = addDays(day, -(n - 1));
  const per_device = all<Row>(`SELECT s.device, d.kind, round(sum(s.minutes)) AS minutes FROM screen_time s
    LEFT JOIN screen_devices d ON d.device = s.device WHERE s.day BETWEEN ? AND ? GROUP BY s.device ORDER BY minutes DESC`, from, day);
  const top_apps = all<Row>(`SELECT app, kind, round(sum(minutes)) AS minutes, group_concat(DISTINCT device) AS devices FROM screen_time
    WHERE day BETWEEN ? AND ? GROUP BY app ORDER BY minutes DESC LIMIT ?`, from, day, Math.max(1, Math.min(50, top)))
    .map((r) => ({ ...r, devices: String(r.devices ?? '').split(',').filter(Boolean) }));
  const by_day = all<Row>('SELECT day, round(sum(minutes)) AS minutes FROM screen_time WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day', from, day);
  const total = per_device.reduce((s, r) => s + Number(r.minutes || 0), 0);
  return {
    from, to: day, days: n,
    total_minutes: Math.round(total),
    avg_minutes_per_day: Math.round(total / n),
    per_device, top_apps, by_day,
    devices: listDevices(),
    note: 'Counts only. Devices overlap (phone + PC at once), so totals are a rough picture.',
  };
};

/** Small Home glance: today's total + the top 3 apps. Null when no device has ever synced. */
export const screenTimeGlance = (day = lifeToday()) => {
  if (!listDevices().length) return null;
  const s = screenTimeSummary(day, 1, 3);
  return { total_minutes: s.total_minutes, top_apps: s.top_apps.map((a) => ({ app: a.app, minutes: a.minutes })), devices: s.devices.length };
};

/** Forget a device and all its rows (the user's choice in Settings). */
export const forgetDevice = (device: string) => {
  const dev = String(device).toLowerCase();
  if (!DEVICE_RE.test(dev)) throw new AppError('bad_request', 'bad device');
  const r = db().prepare('DELETE FROM screen_time WHERE device = ?').run(dev);
  db().prepare('DELETE FROM screen_devices WHERE device = ?').run(dev);
  return { device: dev, removed_rows: Number(r.changes) };
};
