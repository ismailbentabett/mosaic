// Push to the phone through the local ntfy server. Never throws; the token is never logged.
//
// Every push goes through one pipeline, in this order:
//   1. Category switch (kv `push_prefs`): a muted category is logged as 'muted' and not sent. Priority 5 always goes.
//   2. Duplicate: the same title + message sent in the last 10 min is logged as 'deduped' and not sent again.
//   3. Quiet gate, quiet(): a push that is not allowed now is held in `push_held` and delivered by flushHeld()
//      (server tick, every minute) at the next allowed time.
//        - Priority 5 (urgent) always goes.
//        - Rescue: kv `push_silence_until` holds everything below 5 until then.
//        - Mode Zero or Family: only priority 5.
//        - Sleep (profile `sleep.start` / `sleep.wake`, default 23:30–07:30 local time): held until wake.
//        - Saturday (rest day): only priority 4 and up.
//   4. Burst cap: at most `hourly_cap` pushes below priority 4 in any 60 min. Over it, held (reason 'burst').
//   5. Send. A failed send is held (reason 'retry') and tried again every minute until its TTL (max 60 min).
// Every outcome is written to `push_log` (last 500 kept), so "why didn't I get it?" always has an answer.
// Pushes with `channel: 'ops'` (server health) go to NTFY_OPS_TOPIC when set, else the main topic.
import { cfg, secret } from './config.ts';
import { getDb, kvGet, kvSet } from './db.ts';
import { TZ, OFFSET, dateOf, dowOf, addDays, iso } from './time.ts';

export type PushAction = { action: 'http' | 'view'; label: string; url: string; method?: string; headers?: Record<string, string>; body?: string; clear?: boolean };
export const PUSH_CATS = ['tasks', 'blocks', 'timer', 'gym', 'brief', 'docs', 'wishlist', 'nightly', 'ops', 'custom'] as const;
export type PushCat = (typeof PUSH_CATS)[number];
export type PushMsg = {
  title: string; message: string; priority?: 1 | 2 | 3 | 4 | 5; tags?: string[]; click?: string; actions?: PushAction[];
  /** 'ops' = server/operator alerts (separate topic when NTFY_OPS_TOPIC is set). */
  channel?: 'life' | 'ops';
  /** What kind of push this is. Drives the on/off switch and the default tap target. */
  cat?: PushCat;
  /** Same key replaces an older held push (e.g. one health check flapping all night). */
  key?: string;
  /** Minutes a held push stays useful. Past that it is dropped, not delivered late. */
  ttlMin?: number;
  /** Skip switches, dedupe, quiet hours and the hourly cap. Only for a push he asked for this second (Test). */
  force?: boolean;
};

export type QuietReason = 'rescue' | 'mode' | 'sleep' | 'saturday' | 'burst' | 'retry';
export type Quiet = { quiet: false } | { quiet: true; reason: QuietReason; until: string | null };
export type PushStatus = 'sent' | 'held' | 'failed' | 'deduped' | 'muted';
export type PushResult = { status: PushStatus; reason?: string | null; until?: string | null };

const MIN = 60_000;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEDUPE_MIN = 10;
const RETRY_TTL_MIN = 60;
const LOG_KEEP = 500;

const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00${OFFSET}`);
const hmOf = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const mins = (hm: string) => { const m = HM_RE.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// ---------------------------------------------------------------------------------------------------
// Preferences (kv `push_prefs`). Defaults are the calm, useful set: everything on, 2-min block heads-up.
// ---------------------------------------------------------------------------------------------------
export type PushPrefs = {
  cats: Record<PushCat, boolean>;
  /** Minutes before a block starts that its heads-up goes out (0–30). */
  block_lead_min: number;
  /** Max pushes below priority 4 in any 60 min (1–30). */
  hourly_cap: number;
  /** Minutes a snooze waits (5–120). */
  snooze_min: number;
};
export const CAT_LABELS: Record<PushCat, string> = {
  tasks: 'Task reminders', blocks: 'Block heads-up', timer: 'Timer and rest', gym: 'Gym', brief: 'Morning brief',
  docs: 'Document dates', wishlist: 'Wishlist', nightly: 'Nightly plan', ops: 'Server health', custom: 'Other',
};
export const DEFAULT_PREFS: PushPrefs = {
  cats: Object.fromEntries(PUSH_CATS.map((c) => [c, true])) as Record<PushCat, boolean>,
  block_lead_min: 2, hourly_cap: 6, snooze_min: 10,
};
const clampInt = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
export const getPushPrefs = (): PushPrefs => {
  let raw: Partial<PushPrefs> = {};
  try { raw = JSON.parse(kvGet('push_prefs') ?? '{}') ?? {}; } catch { raw = {}; }
  const cats = { ...DEFAULT_PREFS.cats };
  for (const c of PUSH_CATS) if (typeof raw.cats?.[c] === 'boolean') cats[c] = raw.cats[c];
  return {
    cats,
    block_lead_min: clampInt(raw.block_lead_min, 0, 30, DEFAULT_PREFS.block_lead_min),
    hourly_cap: clampInt(raw.hourly_cap, 1, 30, DEFAULT_PREFS.hourly_cap),
    snooze_min: clampInt(raw.snooze_min, 5, 120, DEFAULT_PREFS.snooze_min),
  };
};
/** Merge a partial change. Unknown categories and out-of-range numbers are ignored or clamped, never stored. */
export const setPushPrefs = (patch: { cats?: Partial<Record<string, boolean>>; block_lead_min?: number; hourly_cap?: number; snooze_min?: number }) => {
  const cur = getPushPrefs();
  const cats = { ...cur.cats };
  for (const [k, v] of Object.entries(patch.cats ?? {})) if ((PUSH_CATS as readonly string[]).includes(k) && typeof v === 'boolean') cats[k as PushCat] = v;
  const next: PushPrefs = {
    cats,
    block_lead_min: patch.block_lead_min == null ? cur.block_lead_min : clampInt(patch.block_lead_min, 0, 30, cur.block_lead_min),
    hourly_cap: patch.hourly_cap == null ? cur.hourly_cap : clampInt(patch.hourly_cap, 1, 30, cur.hourly_cap),
    snooze_min: patch.snooze_min == null ? cur.snooze_min : clampInt(patch.snooze_min, 5, 120, cur.snooze_min),
  };
  kvSet('push_prefs', JSON.stringify(next));
  return next;
};

// ---------------------------------------------------------------------------------------------------
// Tap targets. Every push opens the app on the right screen (mosaic://open?to=…, see web/src/native.ts).
// ---------------------------------------------------------------------------------------------------
const CLICK_TO: Record<PushCat, string> = {
  tasks: 'tasks', blocks: 'today', timer: 'today', gym: 'gym', brief: 'today', docs: 'documents',
  wishlist: 'money', nightly: 'today', ops: 'checks', custom: 'home',
};
export const openLink = (to: string) => `mosaic://open?to=${encodeURIComponent(to)}`;
const catOf = (p: PushMsg): PushCat => p.cat ?? (p.channel === 'ops' ? 'ops' : 'custom');
const finish = (p: PushMsg): PushMsg => ({ ...p, cat: catOf(p), click: p.click ?? openLink(CLICK_TO[catOf(p)]) });

// ---------------------------------------------------------------------------------------------------
// Quiet gate
// ---------------------------------------------------------------------------------------------------
/** A profile fact as HH:MM, or null. Profile values are stored as JSON strings. */
const profileHm = (key: string): string | null => {
  try {
    const r = getDb().prepare('SELECT value FROM profile_facts WHERE key = ?').get(key) as { value: string } | undefined;
    if (!r) return null;
    let v: unknown = r.value;
    try { v = JSON.parse(r.value); } catch { /* raw */ }
    return typeof v === 'string' && HM_RE.test(v) ? v : null;
  } catch { return null; }
};

/** Sleep window [start, wake) in local HH:MM. Profile wins; default 23:30–07:30. */
export const sleepWindow = () => ({ start: profileHm('sleep.start') ?? '23:30', wake: profileHm('sleep.wake') ?? '07:30' });

const sleepUntil = (now: Date): number | null => {
  const { start, wake } = sleepWindow();
  const s = mins(start)!, w = mins(wake)!, t = mins(hmOf(now))!;
  const day = dateOf(now);
  if (s === w) return null;
  if (s < w) return t >= s && t < w ? at(day, wake) : null;
  // window crosses midnight (e.g. 23:00–07:00)
  if (t >= s) return at(addDays(day, 1), wake);
  if (t < w) return at(day, wake);
  return null;
};

const modeNow = () => { try { return (kvGet('mode') ?? 'Normal').trim().toLowerCase(); } catch { return 'normal'; } };
const silenceUntil = () => { try { const u = kvGet('push_silence_until'); const t = u ? Date.parse(u) : NaN; return Number.isFinite(t) ? t : null; } catch { return null; } };

/** The one gate for pushes and server-side sounds. Pure on its inputs except kv/profile reads. */
export const quiet = (priority = 3, now = new Date()): Quiet => {
  if (priority >= 5) return { quiet: false };
  const isoAt = (ms: number | null) => (ms == null ? null : iso(new Date(ms)));
  const sil = silenceUntil();
  if (sil && sil > now.getTime()) return { quiet: true, reason: 'rescue', until: isoAt(sil) };
  const mode = modeNow();
  if (mode === 'zero' || mode === 'family') return { quiet: true, reason: 'mode', until: null };
  const sl = sleepUntil(now);
  if (sl) return { quiet: true, reason: 'sleep', until: isoAt(sl) };
  const day = dateOf(now);
  if (dowOf(day) === 6 && priority < 4) return { quiet: true, reason: 'saturday', until: isoAt(at(addDays(day, 1), '00:00')) };
  return { quiet: false };
};

/** Burst cap: pushes below 4 sent in the last 60 min. Returns when a slot frees up, or null when there is room. */
const burstUntil = (priority: number, now: Date, extra = 0): number | null => {
  if (priority >= 4) return null;
  const cap = getPushPrefs().hourly_cap;
  try {
    const rows = getDb().prepare("SELECT at FROM push_log WHERE status = 'sent' AND priority < 4 AND (reason IS NULL OR reason NOT IN ('in digest', 'test')) AND at > ? ORDER BY at")
      .all(iso(new Date(now.getTime() - 60 * MIN))) as { at: string }[];
    if (rows.length + extra < cap) return null;
    return Date.parse(rows[Math.max(0, rows.length + extra - cap)]?.at ?? iso(now)) + 60 * MIN;
  } catch { return null; }
};

// ---------------------------------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------------------------------
export type PushLogRow = { id: number; at: string; cat: string; title: string; message: string; priority: number; status: PushStatus; reason: string | null; key: string | null };
const log = (p: PushMsg, status: PushStatus, reason: string | null, now: Date) => {
  try {
    const db = getDb();
    db.prepare('INSERT INTO push_log (at, cat, title, message, priority, status, reason, key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(iso(now), catOf(p), p.title.slice(0, 200), p.message.slice(0, 1000), p.priority ?? 3, status, reason, p.key ?? null);
    db.prepare('DELETE FROM push_log WHERE id <= (SELECT id FROM push_log ORDER BY id DESC LIMIT 1 OFFSET ?)').run(LOG_KEEP);
  } catch (e) { console.error('push log failed:', (e as Error).message); }
};
export const pushLog = (limit = 50, cat?: string): PushLogRow[] => {
  const n = clampInt(limit, 1, LOG_KEEP, 50);
  const db = getDb();
  return (cat
    ? db.prepare('SELECT * FROM push_log WHERE cat = ? ORDER BY id DESC LIMIT ?').all(cat, n)
    : db.prepare('SELECT * FROM push_log ORDER BY id DESC LIMIT ?').all(n)) as PushLogRow[];
};

const isDuplicate = (p: PushMsg, now: Date) => {
  try {
    return !!getDb().prepare("SELECT 1 FROM push_log WHERE status = 'sent' AND title = ? AND message = ? AND at > ? LIMIT 1")
      .get(p.title.slice(0, 200), p.message.slice(0, 1000), iso(new Date(now.getTime() - DEDUPE_MIN * MIN)));
  } catch { return false; }
};

// ---------------------------------------------------------------------------------------------------
// Send / hold
// ---------------------------------------------------------------------------------------------------
const send = async (p: PushMsg): Promise<boolean> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = secret('NTFY_BOT_TOKEN');
    if (token) headers.Authorization = `Bearer ${token}`;
    const life = cfg('NTFY_TOPIC', 'mosaic');
    const topic = p.channel === 'ops' ? cfg('NTFY_OPS_TOPIC', life) : life;
    const body: Record<string, unknown> = { topic, title: p.title, message: p.message };
    if (p.priority) body.priority = p.priority;
    if (p.tags?.length) body.tags = p.tags;
    if (p.click) body.click = p.click;
    if (p.actions?.length) body.actions = p.actions.slice(0, 3);
    const res = await fetch(`http://127.0.0.1:${cfg('NTFY_PORT', '2586')}/`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`ntfy push failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error('ntfy push failed:', (e as Error).message);
    return false;
  }
};

/** Put a push on hold. A keyed push replaces an older held one with the same key. */
const hold = (p: PushMsg, reason: QuietReason, now: Date) => {
  const db = getDb();
  const ttl = reason === 'retry' ? Math.min(p.ttlMin ?? RETRY_TTL_MIN, RETRY_TTL_MIN) : p.ttlMin;
  const expires = ttl ? iso(new Date(now.getTime() + ttl * MIN)) : null;
  if (p.key) db.prepare('DELETE FROM push_held WHERE key = ?').run(p.key);
  db.prepare('INSERT INTO push_held (key, msg, priority, reason, held_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(p.key ?? null, JSON.stringify(p), p.priority ?? 3, reason, iso(now), expires);
};

/** Drop a held push by key (e.g. a check that broke and fixed itself while he slept). Returns true if one was held. */
export const cancelHeld = (key: string): boolean => {
  try { return Number(getDb().prepare('DELETE FROM push_held WHERE key = ?').run(key).changes) > 0; } catch { return false; }
};

/** Full pipeline with the outcome. Never throws. */
export const notify = async (raw: PushMsg, now = new Date()): Promise<PushResult> => {
  const p = finish(raw);
  const prio = p.priority ?? 3;
  if (raw.force) {
    if (await send(p)) { log(p, 'sent', 'test', now); return { status: 'sent' }; }
    log(p, 'failed', 'send failed', now); return { status: 'failed', reason: 'send failed' };
  }
  if (prio < 5 && !getPushPrefs().cats[p.cat!]) { log(p, 'muted', 'category off', now); return { status: 'muted', reason: 'category off' }; }
  if (isDuplicate(p, now)) { log(p, 'deduped', 'same push in the last 10 min', now); return { status: 'deduped', reason: 'same push in the last 10 min' }; }
  const q = quiet(prio, now);
  const b = q.quiet ? null : burstUntil(prio, now);
  const reason: QuietReason | null = q.quiet ? q.reason : b ? 'burst' : null;
  if (reason) {
    const until = q.quiet ? q.until : iso(new Date(b!));
    try { hold(p, reason, now); log(p, 'held', reason, now); return { status: 'held', reason, until }; }
    catch (e) { console.error('ntfy hold failed:', (e as Error).message); log(p, 'failed', 'hold failed', now); return { status: 'failed', reason: 'hold failed' }; }
  }
  if (await send(p)) { log(p, 'sent', null, now); return { status: 'sent' }; }
  try { hold(p, 'retry', now); log(p, 'held', 'retry', now); return { status: 'held', reason: 'retry', until: iso(new Date(now.getTime() + MIN)) }; }
  catch { log(p, 'failed', 'send failed', now); return { status: 'failed', reason: 'send failed' }; }
};

/**
 * Send now, or hold for the next allowed time. Returns true when sent, held or deliberately skipped
 * (muted, duplicate): the push is not lost. False only when it could not be sent or held.
 */
export const push = async (p: PushMsg, now = new Date()): Promise<boolean> => (await notify(p, now)).status !== 'failed';

export type HeldRow = { id: number; key: string | null; title: string; message: string; cat: string; priority: number; reason: QuietReason; held_at: string; expires_at: string | null };
export const heldList = (): HeldRow[] => {
  try {
    const rows = getDb().prepare('SELECT id, key, msg, priority, reason, held_at, expires_at FROM push_held ORDER BY priority DESC, id').all() as
      { id: number; key: string | null; msg: string; priority: number; reason: QuietReason; held_at: string; expires_at: string | null }[];
    return rows.map((r) => {
      let m: PushMsg = { title: '?', message: '' };
      try { m = JSON.parse(r.msg) as PushMsg; } catch { /* keep placeholder */ }
      return { id: r.id, key: r.key, title: m.title, message: m.message, cat: catOf(m), priority: r.priority, reason: r.reason, held_at: r.held_at, expires_at: r.expires_at };
    });
  } catch { return []; }
};
export const dropHeld = (id: number) => {
  try { return Number(getDb().prepare('DELETE FROM push_held WHERE id = ?').run(id).changes) > 0; } catch { return false; }
};
export const heldCount = () => {
  try { return Number((getDb().prepare('SELECT COUNT(*) AS n FROM push_held').get() as { n: number }).n); } catch { return 0; }
};

/**
 * Deliver held pushes that are allowed now. Expired ones are dropped. At most 3 go out one by one;
 * the rest are folded into one "While you were away" push, so waking up is never a wall of buzzes.
 * `force` sends every held push now (the Send-now button), ignoring quiet, but still one digest.
 */
export const flushHeld = async (now = new Date(), force = false) => {
  const db = getDb();
  db.prepare('DELETE FROM push_held WHERE expires_at IS NOT NULL AND expires_at < ?').run(iso(now));
  const rows = db.prepare('SELECT id, msg, priority, reason FROM push_held ORDER BY priority DESC, id').all() as { id: number; msg: string; priority: number; reason: QuietReason }[];
  const ready = force ? rows : rows.filter((r) => !quiet(r.priority, now).quiet);
  if (!ready.length) return { sent: 0, held: rows.length };
  // The burst cap still counts here (urgent ones and the Send-now button are exempt).
  const room = (prio: number, extra: number) => force || burstUntil(prio, now, extra) == null;
  const one: typeof ready = [];
  const rest: typeof ready = [];
  for (const r of ready) {
    if (one.length < (ready.length > 3 ? 2 : 3) && room(r.priority, one.filter((x) => x.priority < 4).length)) one.push(r);
    else rest.push(r);
  }
  let sent = 0;
  for (const r of one) {
    const m = JSON.parse(r.msg) as PushMsg;
    const ok = await send(m);
    if (ok) { db.prepare('DELETE FROM push_held WHERE id = ?').run(r.id); log(m, 'sent', r.reason === 'retry' ? 'retried' : `after ${r.reason}`, now); sent++; }
  }
  if (rest.length && room(2, one.length)) {
    const msgs = rest.map((r) => JSON.parse(r.msg) as PushMsg);
    const digest: PushMsg = {
      title: `While you were away: ${rest.length} more`,
      message: msgs.map((m) => `• ${m.title}`).join('\n').slice(0, 600),
      priority: 2, cat: 'custom', click: openLink('notifications'),
    };
    if (await send(digest)) {
      for (const r of rest) db.prepare('DELETE FROM push_held WHERE id = ?').run(r.id);
      log(digest, 'sent', null, now);
      for (const m of msgs) log(m, 'sent', 'in digest', now);
      sent += rest.length;
    }
  }
  return { sent, held: rows.length - sent };
};

/** What the gate says right now, for the Notifications screen and chat. */
export const quietNow = (now = new Date()) => {
  const q = quiet(3, now);
  const b = q.quiet ? null : burstUntil(3, now);
  return {
    quiet: q.quiet || !!b,
    reason: q.quiet ? q.reason : b ? 'burst' : null,
    until: q.quiet ? q.until : b ? iso(new Date(b)) : null,
    sleep: sleepWindow(),
    mode: modeNow(),
    held: heldCount(),
  };
};
