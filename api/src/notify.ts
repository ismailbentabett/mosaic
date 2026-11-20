// Reminders that come to the user: everything time-based that ends in a push, run once a minute by the server.
//   - Task reminders: an open task due today with a due time pings at that time (Done / Start timer / Snooze).
//   - Block heads-up: a block task (mirrored by set_block_task, tasks.event_id) pings `block_lead_min` before
//     the block starts. Priority blocks at push priority 4, the rest at 3.
//   - Imported reminders (`reminders` table, from a task CSV): ping at their time, once.
//   - Scheduled pushes (`push_scheduled`): "remind me at 15:00", snoozes. One-shot.
//   - Morning brief: once a day, 5 min after wake, what today holds. Never on Saturday.
// Each reminder fires once per task, day and time (`push_marks`); changing the time re-arms it.
// A reminder found more than GRACE_MIN late (server was down) is skipped, never sent stale.
// All of it goes through ntfy.notify(): category switches, quiet gate, burst cap, log.
import { getDb } from './db.ts';
import { PUBLIC_URL } from './config.ts';
import { OFFSET, dateOf, dowOf, hhmm, iso } from './time.ts';
import { AppError } from './errors.ts';
import { notify, cancelHeld, getPushPrefs, sleepWindow, openLink, type PushMsg, type PushCat, type PushResult } from './ntfy.ts';
import { taskPushActions } from './modules/extras/store.ts';

const MIN = 60_000;
const GRACE_MIN = 10;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

type TaskLite = {
  id: string; title: string; due_date: string | null; due_time: string | null; est_minutes: number | null;
  first_action: string | null; done_def: string | null; priority: number; event_id: string | null; status: string;
};
const COLS = 'id, title, due_date, due_time, est_minutes, first_action, done_def, priority, event_id, status';
const taskById = (id: string) =>
  getDb().prepare(`SELECT ${COLS} FROM tasks WHERE id = ? AND deleted_at IS NULL`).get(id) as TaskLite | undefined;

/** Marks: true the first time a key is seen, false after. */
const firstTime = (k: string, now: Date) =>
  Number(getDb().prepare('INSERT OR IGNORE INTO push_marks (k, at) VALUES (?, ?)').run(k, iso(now)).changes) > 0;

const atMs = (day: string, hm: string) => Date.parse(`${day}T${hm}:00${OFFSET}`);
const dot = (s: string | null | undefined) => (s ?? '').trim().replace(/\.+$/, '');

/** The push for a task. kind: 'now' (task time), 'block' (heads-up before a block), 'snooze' (came back). */
export const taskPush = (t: TaskLite, kind: 'now' | 'block' | 'snooze', leadMin = 0): PushMsg => {
  const must = !!t.event_id && t.priority >= 3;
  const head =
    kind === 'block' ? `${leadMin ? `In ${leadMin} min` : 'Now'}${t.due_time ? ` (${t.due_time})` : ''}`
      : kind === 'snooze' ? 'Back from snooze' : `Now${t.due_time ? ` (${t.due_time})` : ''}`;
  const meta = [head, t.est_minutes ? `${t.est_minutes}m` : null, must ? 'Priority' : null].filter(Boolean).join(' · ');
  const lines = [meta];
  if (dot(t.first_action)) lines.push(`First: ${dot(t.first_action)}.`);
  if (dot(t.done_def)) lines.push(`Done = ${dot(t.done_def)}.`);
  const prefs = getPushPrefs();
  return {
    title: t.title.slice(0, 100),
    message: lines.join('\n'),
    priority: must ? 4 : 3,
    cat: t.event_id ? 'blocks' : 'tasks',
    key: `task:${t.id}`,
    ttlMin: kind === 'block' ? leadMin + 15 : 30,
    click: openLink(t.event_id ? 'today' : 'tasks'),
    actions: taskPushActions(PUBLIC_URL, t.id, ['done', 'start', 'snooze'], prefs.snooze_min),
  };
};

// ---------------------------------------------------------------------------------------------------
// Scheduled pushes
// ---------------------------------------------------------------------------------------------------
export type ScheduledRow = { id: number; key: string | null; at: string; title: string; message: string; cat: string; task_id: string | null; created_at: string };

/** Schedule a one-shot push. A keyed push replaces an older one with the same key. `at` is ISO or HH:MM (today, else tomorrow). */
export const schedulePush = (a: {
  at: string; title?: string; message?: string; priority?: 1 | 2 | 3 | 4 | 5; cat?: PushCat; key?: string | null; task_id?: string | null;
}, now = new Date()): ScheduledRow => {
  let when: number;
  if (HM_RE.test(a.at)) {
    when = atMs(dateOf(now), a.at);
    if (when <= now.getTime()) when = atMs(dateOf(new Date(now.getTime() + 86_400_000)), a.at);
  } else when = Date.parse(a.at);
  if (!Number.isFinite(when)) throw new AppError('bad_request', 'at must be HH:MM or an ISO date-time');
  if (when < now.getTime() - MIN) throw new AppError('bad_request', 'That time has passed.');
  if (when > now.getTime() + 60 * 86_400_000) throw new AppError('bad_request', 'At most 60 days ahead.');
  let task: TaskLite | undefined;
  if (a.task_id) { task = taskById(a.task_id); if (!task) throw new AppError('not_found', `task ${a.task_id}`); }
  const title = (a.title ?? task?.title ?? '').trim().slice(0, 100);
  if (!title) throw new AppError('bad_request', 'title is required');
  const msg: PushMsg = { title, message: (a.message ?? '').trim().slice(0, 1000) || 'Reminder.', priority: a.priority ?? 3, cat: a.cat ?? (task ? 'tasks' : 'custom') };
  const db = getDb();
  if (a.key) db.prepare('DELETE FROM push_scheduled WHERE key = ?').run(a.key);
  const r = db.prepare('INSERT INTO push_scheduled (key, at, msg, task_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(a.key ?? null, iso(new Date(when)), JSON.stringify(msg), task?.id ?? null, iso(now));
  return scheduledList().find((x) => x.id === Number(r.lastInsertRowid))!;
};

export const scheduledList = (): ScheduledRow[] => {
  const rows = getDb().prepare('SELECT id, key, at, msg, task_id, created_at FROM push_scheduled ORDER BY at, id').all() as
    { id: number; key: string | null; at: string; msg: string; task_id: string | null; created_at: string }[];
  return rows.map((r) => {
    let m: PushMsg = { title: '?', message: '' };
    try { m = JSON.parse(r.msg) as PushMsg; } catch { /* keep */ }
    return { id: r.id, key: r.key, at: r.at, title: m.title, message: m.message, cat: m.cat ?? 'custom', task_id: r.task_id, created_at: r.created_at };
  });
};
export const cancelScheduled = (id: number) => Number(getDb().prepare('DELETE FROM push_scheduled WHERE id = ?').run(id).changes) > 0;

/** Snooze a task reminder: it comes back in `minutes` (default from prefs). */
export const snoozeTask = (task_id: string, minutes = getPushPrefs().snooze_min, now = new Date()) => {
  const t = taskById(task_id);
  if (!t) throw new AppError('not_found', `task ${task_id}`);
  const at = iso(new Date(now.getTime() + minutes * MIN));
  return schedulePush({ at, task_id: t.id, key: `snooze:${t.id}`, cat: t.event_id ? 'blocks' : 'tasks' }, now);
};

const runScheduled = async (now: Date) => {
  const db = getDb();
  const due = db.prepare('SELECT id, msg, task_id FROM push_scheduled WHERE at <= ? ORDER BY at, id').all(iso(now)) as { id: number; msg: string; task_id: string | null }[];
  const out: PushResult[] = [];
  for (const r of due) {
    db.prepare('DELETE FROM push_scheduled WHERE id = ?').run(r.id);
    if (r.task_id) {
      const t = taskById(r.task_id);
      if (!t || t.status !== 'open') continue; // done or dropped meanwhile: nothing to remind
      const base = taskPush(t, 'snooze');
      let m: PushMsg | null = null;
      try { m = JSON.parse(r.msg) as PushMsg; } catch { /* keep base */ }
      // A hand-made reminder about a task keeps its own words; a snooze is the task push again.
      out.push(await notify(m && m.message !== 'Reminder.' && m.title !== t.title ? { ...base, title: m.title, message: m.message } : base, now));
    } else {
      try { out.push(await notify({ ...(JSON.parse(r.msg) as PushMsg), ttlMin: 120 }, now)); } catch { /* bad row: dropped */ }
    }
  }
  return out.length;
};

// ---------------------------------------------------------------------------------------------------
// Task + block reminders
// ---------------------------------------------------------------------------------------------------
const runTaskReminders = async (now: Date) => {
  const day = dateOf(now);
  const t0 = now.getTime();
  const lead = getPushPrefs().block_lead_min;
  const rows = getDb().prepare(`SELECT ${COLS} FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND due_date = ? AND due_time IS NOT NULL`)
    .all(day) as TaskLite[];
  let n = 0;
  for (const t of rows) {
    if (!t.due_time || !HM_RE.test(t.due_time)) continue;
    const block = !!t.event_id;
    const fireAt = atMs(day, t.due_time) - (block ? lead * MIN : 0);
    if (t0 < fireAt || t0 >= fireAt + GRACE_MIN * MIN) continue;
    if (!firstTime(`r:${t.id}:${day}:${t.due_time}`, now)) continue;
    await notify(taskPush(t, block ? 'block' : 'now', lead), now);
    n++;
  }
  // Imported reminders (exact times).
  const rem = getDb().prepare('SELECT id, task_id, at FROM reminders WHERE sent_at IS NULL AND at IS NOT NULL AND deleted_at IS NULL').all() as { id: string; task_id: string; at: string }[];
  for (const r of rem) {
    const w = Date.parse(r.at);
    if (!Number.isFinite(w) || w > t0) continue;
    getDb().prepare('UPDATE reminders SET sent_at = ? WHERE id = ?').run(iso(now), r.id);
    if (t0 - w >= GRACE_MIN * MIN) continue;
    const t = taskById(r.task_id);
    if (!t || t.status !== 'open') continue;
    await notify(taskPush(t, 'now'), now);
    n++;
  }
  return n;
};

// ---------------------------------------------------------------------------------------------------
// Morning brief
// ---------------------------------------------------------------------------------------------------
/** What today holds, from local data only (tasks; block tasks are mirrored there). */
export const morningBrief = (day = dateOf()): PushMsg => {
  const rows = getDb().prepare(`SELECT ${COLS} FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND due_date = ? ORDER BY due_time IS NULL, due_time, priority DESC`)
    .all(day) as TaskLite[];
  const musts = rows.filter((t) => t.event_id && t.priority >= 3);
  const timed = rows.filter((t) => t.due_time);
  const lines: string[] = [];
  if (!rows.length) lines.push('Nothing planned yet. Open Today and pick one thing.');
  else {
    if (musts.length) lines.push(`Priority: ${musts.map((t) => t.title).join(' · ')}`);
    if (timed[0]) lines.push(`First at ${timed[0].due_time}: ${timed[0].title}${dot(timed[0].first_action) ? `. First: ${dot(timed[0].first_action)}.` : ''}`);
    lines.push(`${rows.length} task${rows.length === 1 ? '' : 's'} today.`);
  }
  return { title: 'Today', message: lines.join('\n').slice(0, 1000), priority: 3, cat: 'brief', key: `brief:${day}`, ttlMin: 180, click: openLink('today') };
};

const runBrief = async (now: Date) => {
  const day = dateOf(now);
  if (dowOf(day) === 6) return 0; // rest day
  const wake = atMs(day, sleepWindow().wake) + 5 * MIN;
  const t0 = now.getTime();
  if (t0 < wake || t0 >= wake + 3 * 60 * MIN) return 0;
  if (!firstTime(`brief:${day}`, now)) return 0;
  await notify(morningBrief(day), now);
  return 1;
};

/** Once a minute from server.ts. Never throws; each part fails alone. */
export const remindersTick = async (now = new Date()) => {
  const part = async (name: string, fn: () => Promise<number>) => {
    try { return await fn(); } catch (e) { console.error(`${name}:`, (e as Error).message); return 0; }
  };
  const out = {
    scheduled: await part('scheduledPushes', () => runScheduled(now)),
    tasks: await part('taskReminders', () => runTaskReminders(now)),
    brief: await part('morningBrief', () => runBrief(now)),
  };
  try { getDb().prepare('DELETE FROM push_marks WHERE at < ?').run(iso(new Date(now.getTime() - 8 * 86_400_000))); } catch { /* next tick */ }
  return out;
};

/** What fires next today, for the Notifications screen: block heads-ups, task reminders, scheduled pushes. */
export const upcoming = (now = new Date()) => {
  const day = dateOf(now);
  const lead = getPushPrefs().block_lead_min;
  const t0 = now.getTime();
  const rows = getDb().prepare(`SELECT ${COLS} FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND due_date = ? AND due_time IS NOT NULL ORDER BY due_time`)
    .all(day) as TaskLite[];
  const items: { at: string; hhmm: string; kind: 'block' | 'task' | 'scheduled'; title: string; task_id: string | null; id?: number }[] = [];
  for (const t of rows) {
    if (!t.due_time || !HM_RE.test(t.due_time)) continue;
    const fireAt = atMs(day, t.due_time) - (t.event_id ? lead * MIN : 0);
    if (fireAt + GRACE_MIN * MIN <= t0) continue;
    items.push({ at: iso(new Date(fireAt)), hhmm: hhmm(new Date(fireAt)), kind: t.event_id ? 'block' : 'task', title: t.title, task_id: t.id });
  }
  for (const s of scheduledList()) items.push({ at: s.at, hhmm: hhmm(new Date(Date.parse(s.at))), kind: 'scheduled', title: s.title, task_id: s.task_id, id: s.id });
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
};

/** A task was finished or moved: drop its pending snooze and any held push about it. */
export const cancelTaskPushes = (task_id: string) => {
  getDb().prepare('DELETE FROM push_scheduled WHERE task_id = ?').run(task_id);
  cancelHeld(`task:${task_id}`);
};
