// One focus timer, persisted in the db `timer` row so it survives restarts.
// Linked to an app task when started from one; every ended or stopped sprint is logged to focus_sessions.
import { getDb, kvGet, kvSet } from './db.ts';
import { AppError } from './errors.ts';
import { iso } from './time.ts';
import { push } from './ntfy.ts';
import { PUBLIC_URL } from './config.ts';

export type Timer = {
  label: string; startedAt: string; endsAt: string; pausedAt?: string | null; pauseReason?: string | null; pausedMs?: number;
  taskId?: string | null;
};
export const PAUSE_REASONS = ['family', 'power', 'other'] as const;
type Pause = { at: string | null; reason: string | null; total_ms: number };
const PKEY = 'timer:pause';
const TKEY = 'timer:task';
const getPause = (): Pause => { try { return { at: null, reason: null, total_ms: 0, ...JSON.parse(kvGet(PKEY) ?? '{}') }; } catch { return { at: null, reason: null, total_ms: 0 }; } };
const setPause = (p: Pause) => kvSet(PKEY, JSON.stringify(p));

let handle: ReturnType<typeof setTimeout> | null = null;

const clearRow = () => {
  getDb().prepare('DELETE FROM timer WHERE id = 1').run();
  setPause({ at: null, reason: null, total_ms: 0 });
  kvSet(TKEY, '');
};
const disarm = () => {
  if (handle) clearTimeout(handle);
  handle = null;
};

/** Worked minutes of a sprint (paused time left out), rounded. */
export const workedMinutes = (t: Timer, at = Date.now()) => {
  const end = Math.min(at, Date.parse(t.endsAt));
  const pausedNow = t.pausedAt ? Math.max(0, at - Date.parse(t.pausedAt)) : 0;
  return Math.round((end - Date.parse(t.startedAt) - (t.pausedMs ?? 0) - pausedNow) / 60000);
};

/** Writes the sprint to focus_sessions. Never throws: the timer must stop even if the log fails. */
const logSprint = async (t: Timer, at = Date.now()) => {
  const minutes = workedMinutes(t, at);
  if (minutes < 1) return null;
  try {
    const { logFocus } = await import('./modules/tasks/store.ts');
    const log = (taskId: string | null) => logFocus(taskId, Math.min(600, minutes), t.startedAt, undefined, t.pausedMs ?? 0, t.pauseReason ?? null);
    try { return log(t.taskId ?? null); } catch { return log(null); } // task deleted meanwhile: keep the minutes
  } catch { return null; }
};

const fire = (t: Timer) => {
  handle = null;
  const cur = getTimer();
  if (!cur || cur.endsAt !== t.endsAt || cur.pausedAt) return; // replaced or paused meanwhile
  void logSprint(cur);
  disarm();
  clearRow();
  void timerDonePush(cur.label);
};

/** Timer done: urgent enough to hear (4), with +5 min from the lock screen. */
const timerDonePush = async (label: string) => {
  let actions: import('./ntfy.ts').PushAction[] = [];
  try { const { pushAction } = await import('./modules/extras/store.ts'); actions = [pushAction(PUBLIC_URL, 'more', label.slice(0, 60))]; } catch { /* no buttons */ }
  return push({ title: 'Timer done', message: label ? `${label}. Stop here or add 5 min.` : 'Stop here or add 5 min.', priority: 4, cat: 'timer', key: 'timer', ttlMin: 10, actions });
};

// setTimeout max is ~24.8 days; timers are ≤ 240 min, so a single timeout is fine.
const arm = (t: Timer) => {
  disarm();
  handle = setTimeout(() => fire(t), Math.max(0, Date.parse(t.endsAt) - Date.now()));
  handle.unref?.();
};

export const getTimer = (): Timer | null => {
  const r = getDb().prepare('SELECT label, started_at, ends_at FROM timer WHERE id = 1').get() as
    | { label: string; started_at: string; ends_at: string } | undefined;
  if (!r) return null;
  const p = getPause();
  return { label: r.label, startedAt: r.started_at, endsAt: r.ends_at, pausedAt: p.at, pauseReason: p.reason, pausedMs: p.total_ms,
    taskId: kvGet(TKEY) || null };
};

/** Pause: the end time stops moving closer. No push fires while paused. */
export const pauseTimer = (reason = 'other'): Timer => {
  const t = getTimer();
  if (!t) throw new AppError('not_found', 'no timer running');
  if (!(PAUSE_REASONS as readonly string[]).includes(reason)) throw new AppError('bad_request', `reason must be ${PAUSE_REASONS.join(', ')}`);
  if (t.pausedAt) return t;
  disarm();
  setPause({ at: new Date().toISOString(), reason, total_ms: t.pausedMs ?? 0 });
  return getTimer()!;
};

/** Resume: the end time moves later by the paused time. */
export const resumeTimer = (): Timer => {
  const t = getTimer();
  if (!t) throw new AppError('not_found', 'no timer running');
  if (!t.pausedAt) return t;
  const gap = Math.max(0, Date.now() - Date.parse(t.pausedAt));
  const endsAt = iso(new Date(Date.parse(t.endsAt) + gap));
  getDb().prepare('UPDATE timer SET ends_at = ? WHERE id = 1').run(endsAt);
  setPause({ at: null, reason: t.pauseReason ?? null, total_ms: (t.pausedMs ?? 0) + gap });
  const n = getTimer()!;
  arm(n);
  return n;
};

export const startTimer = (minutes: number, label: string, taskId?: string | null): Timer => {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new AppError('bad_request', 'minutes must be 1–240');
  const l = String(label ?? '').replace(/\s+/g, ' ').trim() || 'Focus';
  if (l.length > 80) throw new AppError('bad_request', 'label max 80 characters');
  if (taskId != null && (typeof taskId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(taskId))) throw new AppError('bad_request', 'bad taskId');
  const prev = getTimer();
  if (prev) void logSprint(prev); // replacing a running sprint still records the minutes worked
  const now = new Date();
  const t: Timer = { label: l, startedAt: iso(now), endsAt: iso(new Date(now.getTime() + minutes * 60000)), taskId: taskId ?? null };
  getDb()
    .prepare('INSERT INTO timer (id, label, started_at, ends_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, started_at = excluded.started_at, ends_at = excluded.ends_at')
    .run(t.label, t.startedAt, t.endsAt);
  setPause({ at: null, reason: null, total_ms: 0 });
  kvSet(TKEY, taskId ?? '');
  arm(t);
  return getTimer()!;
};

/** Stop early: the minutes worked so far are logged. */
export const stopTimer = (): void => {
  const t = getTimer();
  disarm();
  if (t) void logSprint(t);
  clearRow();
};

/** On boot: re-arm a running timer; if it ended while down, log it and push only if < 10 min ago. */
export const restoreTimer = (): void => {
  const t = getTimer();
  if (!t) return;
  if (t.pausedAt) return; // paused: wait for resume
  const left = Date.parse(t.endsAt) - Date.now();
  if (left > 0) return arm(t);
  void logSprint(t);
  clearRow();
  if (-left < 10 * 60000) void timerDonePush(t.label);
};
