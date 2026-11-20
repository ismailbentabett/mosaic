// Who set the mode and when. A Zero set by Rescue covers one life-day only: at the next 04:00 roll
// the mode goes back to what it was, unless the user kept it (rescue keep) or set a mode by hand since.
import { kvGet, kvSet } from './db.ts';
import { canonicalMode, setMode, type Mode } from './sheet.ts';
import { OFFSET, addDays, lifeDay } from './time.ts';

export type ModeBy = 'rescue' | 'user' | 'auto';
export type ModeSet = { mode: Mode; by: ModeBy; at: string; day: string; prev?: Mode; kept?: boolean };

const KEY = 'mode_set';

export const modeSet = (): ModeSet | null => {
  try {
    const v = JSON.parse(kvGet(KEY) ?? 'null') as ModeSet | null;
    return v && canonicalMode(v.mode) ? v : null;
  } catch { return null; }
};

/** Records who set the mode. Call after every mode write. */
export const recordMode = (mode: Mode, by: ModeBy, at = new Date(), prev?: Mode): ModeSet => {
  const s: ModeSet = { mode, by, at: at.toISOString(), day: lifeDay(at), ...(prev ? { prev } : {}) };
  kvSet(KEY, JSON.stringify(s));
  return s;
};

/** The current mode from the app cache (the Sheet copy is synced on every write). */
export const cachedMode = (): Mode => canonicalMode(kvGet('mode')) ?? 'Normal';

/** Rescue Zero that has not been kept: which day it covers, when it ends, what comes after. */
export const rescueState = (at = new Date()) => {
  const s = modeSet();
  if (!s || s.by !== 'rescue' || s.kept) return null;
  const after = s.prev && s.prev !== 'Zero' ? s.prev : 'Normal';
  return { day: s.day, ends_at: `${addDays(s.day, 1)}T04:00:00${OFFSET}`, after, active: lifeDay(at) <= s.day };
};

/** Mode for a life-day: a Rescue Zero only covers its own day, so planning tomorrow uses the mode after it. */
export const modeForDay = (day: string, current: Mode, at = new Date()): Mode => {
  const r = rescueState(at);
  if (!r || current !== 'Zero') return current;
  return day > r.day ? r.after : current;
};

/**
 * Ends a Rescue Zero once the life-day has rolled past it. Safe to call often: does nothing unless due.
 * Returns the restored mode, or null.
 */
export const expireRescueMode = async (at = new Date()): Promise<{ mode: Mode; sheet: 'ok' | 'cache' } | null> => {
  const r = rescueState(at);
  if (!r || r.active) return null;
  if (cachedMode() !== 'Zero') { recordMode(cachedMode(), 'auto', at); return null; }
  kvSet('mode', r.after);
  kvSet('push_silence_until', '');
  let sheet: 'ok' | 'cache' = 'cache';
  try { await setMode(r.after); sheet = 'ok'; } catch { /* Sheet down: the app cache holds the mode; retried by modeForDay */ }
  if (sheet === 'ok') recordMode(r.after, 'auto', at);
  return { mode: r.after, sheet };
};

/** The user keeps the Zero day past 04:00. It then stays until they change the mode. */
export const keepRescue = () => {
  const s = modeSet();
  if (!s || s.by !== 'rescue') return { kept: false, mode: cachedMode() };
  kvSet(KEY, JSON.stringify({ ...s, kept: true }));
  return { kept: true, mode: s.mode };
};

/** Shape for get_mode / GET /api/mode. */
export const rescueInfo = (at = new Date()) => {
  const r = rescueState(at);
  return r ? { active: r.active, ends_at: r.ends_at, after: r.after } : null;
};
