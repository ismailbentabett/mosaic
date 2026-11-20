// Tasks, projects, areas, habits, goals in app.db.
import { AppError } from '../../errors.ts';
import { addDays, hhmm, isDate, lifeDay, lifeToday, weekStartOf, zonedIso } from '../../time.ts';
import { all, db, idOr, insert, j, need, now, one, patch, purge, restore, run, softDelete, uuid, type Row } from '../util.ts';
import { parseQuickAdd } from './parse.ts';
import { describeRecur, fromRRule, nextOccurrence, validRecur, type Recur } from './recur.ts';

export type TaskRow = {
  id: string; title: string; notes: string; project_id: string | null; parent_id: string | null; section: string | null;
  status: 'open' | 'done' | 'dropped'; priority: number; tags: string[]; start_date: string | null; due_date: string | null;
  due_time: string | null; est_minutes: number | null; first_action: string | null; done_def: string | null;
  recur: Recur | null; recur_parent: string | null; pinned: boolean; waiting_for: string | null; someday: boolean;
  goal_id: string | null; source: string; event_id: string | null;
  legacy_import_id: string | null; sort: number; done_at: string | null; created_at: string; updated_at: string;
  deleted_at: string | null; project_name?: string | null; recur_text?: string | null;
};

export const VIEWS = ['today', 'needs_day', 'upcoming', 'inbox', 'anytime', 'someday', 'waiting', 'done', 'trash', 'all'] as const;
export type View = (typeof VIEWS)[number];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hydrate = (r: Row): TaskRow => {
  const recur = j<Recur | null>(r.recur, null);
  return {
    ...(r as unknown as TaskRow), tags: j<string[]>(r.tags, []), recur, pinned: !!r.pinned, someday: !!r.someday,
    recur_text: recur ? describeRecur(recur) : null,
  };
};
const SELECT = `SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id`;

// ---------- validation ----------
export type TaskInput = {
  id?: string; title?: string; notes?: string; project_id?: string | null; project?: string | null; parent_id?: string | null;
  section?: string | null; priority?: number; tags?: string[]; start_date?: string | null; due_date?: string | null;
  due_time?: string | null; est_minutes?: number | null; first_action?: string | null; done_def?: string | null;
  recur?: Recur | string | null; pinned?: boolean; waiting_for?: string | null; someday?: boolean; goal_id?: string | null;
  source?: string; event_id?: string | null; sort?: number; status?: 'open' | 'done' | 'dropped';
};

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const clean = (t: TaskInput): Row => {
  const r: Row = {};
  if (t.title !== undefined) {
    const s = String(t.title).trim();
    if (!s) bad('title is required');
    if (s.length > 300) bad('title max 300 characters');
    r.title = s;
  }
  if (t.notes !== undefined) r.notes = String(t.notes ?? '').slice(0, 20000);
  for (const k of ['start_date', 'due_date'] as const) if (t[k] !== undefined) {
    if (t[k] !== null && t[k] !== '' && !isDate(t[k])) bad(`${k} must be YYYY-MM-DD`);
    r[k] = t[k] || null;
  }
  if (t.due_time !== undefined) {
    if (t.due_time && !TIME_RE.test(t.due_time)) bad('due_time must be HH:MM');
    r.due_time = t.due_time || null;
  }
  if (t.priority !== undefined) {
    if (!Number.isInteger(t.priority) || t.priority < 0 || t.priority > 3) bad('priority must be 0–3');
    r.priority = t.priority;
  }
  if (t.est_minutes !== undefined) {
    if (t.est_minutes !== null && (!Number.isInteger(t.est_minutes) || t.est_minutes < 1 || t.est_minutes > 1440)) bad('est_minutes must be 1–1440');
    r.est_minutes = t.est_minutes;
  }
  if (t.tags !== undefined) {
    if (!Array.isArray(t.tags)) bad('tags must be a list');
    r.tags = [...new Set(t.tags.map((x) => String(x).trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 30);
  }
  if (t.recur !== undefined) {
    if (t.recur === null || t.recur === '') r.recur = null;
    else {
      const rr = typeof t.recur === 'string' ? (t.recur.toUpperCase().includes('FREQ=') ? fromRRule(t.recur) : parseQuickAdd(`x ${t.recur}`, lifeToday()).recur) : t.recur;
      if (!rr || !validRecur(rr)) bad('recur is not a valid repeat rule');
      r.recur = rr;
    }
  }
  if (t.status !== undefined) {
    if (!['open', 'done', 'dropped'].includes(t.status)) bad('status must be open, done or dropped');
    r.status = t.status;
  }
  for (const k of ['section', 'first_action', 'done_def', 'waiting_for', 'goal_id', 'event_id', 'parent_id', 'source'] as const)
    if (t[k] !== undefined) r[k] = t[k] === null || t[k] === '' ? null : String(t[k]).slice(0, 500);
  if (t.pinned !== undefined) r.pinned = !!t.pinned;
  if (t.someday !== undefined) r.someday = !!t.someday;
  if (t.sort !== undefined) r.sort = Number(t.sort) || 0;
  if (t.project !== undefined && t.project_id === undefined) r.project_id = t.project ? ensureProject(t.project).id : null;
  if (t.project_id !== undefined) r.project_id = t.project_id ? need(getProject(t.project_id), 'project').id : null;
  return r;
};

// ---------- areas / projects ----------
export const listAreas = () => all(`SELECT * FROM areas WHERE deleted_at IS NULL ORDER BY sort, name`);
export const addArea = (name: string, id?: string) => {
  const row = { id: idOr(id), name: String(name).trim() || bad('name is required') };
  insert('areas', row);
  return one(`SELECT * FROM areas WHERE id = ?`, row.id);
};

export const listProjects = (includeArchived = false) => all(
  `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'open' AND t.deleted_at IS NULL) AS open_count
   FROM projects p WHERE p.deleted_at IS NULL ${includeArchived ? '' : `AND p.status = 'active'`} ORDER BY p.sort, p.name`);
export const getProject = (ref: string) => one<Row & { id: string; name: string }>(
  `SELECT * FROM projects WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
export const ensureProject = (name: string, extra: Row = {}) => {
  const n = String(name).trim();
  if (!n) bad('project name is required');
  const found = getProject(n);
  if (found) return found;
  // Only known columns, with checked types: a stray body key must be a 400, not an SQL error.
  const f: Row = {};
  for (const k of ['area_id', 'emoji', 'note_path'] as const) {
    if (extra[k] == null) continue;
    if (typeof extra[k] !== 'string') bad(`${k} must be text`);
    f[k] = extra[k];
  }
  if (extra.status != null) {
    if (!['active', 'paused', 'done', 'archived'].includes(String(extra.status))) bad('status must be active, paused, done or archived');
    f.status = extra.status;
  }
  if (extra.sort != null) { if (!Number.isInteger(extra.sort)) bad('sort must be a whole number'); f.sort = extra.sort; }
  const id = typeof extra.id === 'string' && extra.id ? extra.id : uuid();
  insert('projects', { id, name: n, ...f });
  return need(getProject(id), 'project');
};
export const updateProject = (id: string, f: { name?: string; area_id?: string | null; status?: string; emoji?: string | null; note_path?: string | null; sort?: number }) => {
  need(getProject(id), 'project');
  if (f.status && !['active', 'paused', 'done', 'archived'].includes(f.status)) bad('status must be active, paused, done or archived');
  patch('projects', id, f as Row);
  return getProject(id);
};

// ---------- tasks CRUD ----------
export const getTask = (id: string) => {
  const r = one(`${SELECT} WHERE t.id = ?`, id);
  return r ? hydrate(r) : undefined;
};
/** Task by id (uuid); 404 when missing. */
export const resolveRef = (ref: string | number): TaskRow => {
  const s = String(ref).trim();
  const r = one(`${SELECT} WHERE t.id = ?`, s);
  return hydrate(need(r, `task ${s}`));
};

export const addTask = (t: TaskInput & { title: string }): TaskRow => {
  const id = idOr(t.id);
  const existing = getTask(id);
  if (existing) return existing; // offline replay
  const row = clean(t);
  if (!row.title) bad('title is required');
  if (row.parent_id) {
    const parent = need(getTask(String(row.parent_id)), 'parent task');
    if (parent.parent_id) bad('subtasks go one level deep');
    if (row.project_id === undefined) row.project_id = parent.project_id;
  }
  insert('tasks', { id, ...row });
  return need(getTask(id), 'task');
};

/** Quick add from one line of text. Explicit fields win over parsed ones. */
export const quickAdd = (text: string, extra: TaskInput = {}, today = lifeToday()) => {
  const p = parseQuickAdd(text, today);
  return addTask({
    title: p.title, tags: p.tags, priority: p.priority, est_minutes: p.est_minutes, due_date: p.due_date ?? null,
    due_time: p.due_time ?? null, recur: p.recur ?? null, project: p.project ?? null,
    notes: p.anchor ? `after ${p.anchor}` : undefined, ...extra,
  } as TaskInput & { title: string });
};

export const updateTask = (ref: string | number, f: TaskInput): TaskRow => {
  const cur = resolveRef(ref);
  const row = clean(f);
  if (row.status === 'done' && cur.status !== 'done') return completeTask(cur.id).task;
  if (row.status === 'open' && cur.status !== 'open') row.done_at = null;
  if (row.status === 'dropped') row.done_at = now();
  if (row.parent_id === cur.id) bad('a task cannot be its own parent');
  patch('tasks', cur.id, row);
  return need(getTask(cur.id), 'task');
};

/**
 * Complete a task. Idempotent: already done → unchanged.
 * Recurring: this row becomes done, the next occurrence is inserted (missed ones collapse).
 */
export const completeTask = (ref: string | number, today = lifeToday()): { task: TaskRow; next: TaskRow | null } => {
  const cur = resolveRef(ref);
  if (cur.status === 'done') return { task: cur, next: null };
  const t = now();
  patch('tasks', cur.id, { status: 'done', done_at: t });
  let next: TaskRow | null = null;
  if (cur.recur) {
    const due = cur.due_date ?? today;
    const nd = nextOccurrence(cur.recur, due, today, today);
    if (nd) {
      const recur = { ...cur.recur, done_count: (cur.recur.done_count ?? 0) + 1 };
      const id = uuid();
      const shift = cur.start_date && cur.due_date ? Math.round((Date.parse(cur.due_date) - Date.parse(cur.start_date)) / 86400000) : null;
      insert('tasks', {
        id, title: cur.title, notes: cur.notes, project_id: cur.project_id, parent_id: cur.parent_id, section: cur.section,
        priority: cur.priority, tags: cur.tags, due_date: nd, due_time: cur.due_time, est_minutes: cur.est_minutes,
        first_action: cur.first_action, done_def: cur.done_def, recur, recur_parent: cur.recur_parent ?? cur.id,
        pinned: cur.pinned, goal_id: cur.goal_id, source: cur.source, sort: cur.sort,
        start_date: shift !== null ? addDays(nd, -shift) : null,
      });
      // subtasks of a recurring parent come back unticked
      for (const s of all<Row>(`SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL`, cur.id))
        insert('tasks', { id: uuid(), title: s.title, notes: s.notes, project_id: s.project_id, parent_id: id, priority: s.priority, tags: s.tags, sort: s.sort, est_minutes: s.est_minutes });
      next = need(getTask(id), 'task');
    }
  }
  return { task: need(getTask(cur.id), 'task'), next };
};

/** Skip this occurrence of a recurring task: move it to the next date without marking done. */
export const skipOccurrence = (ref: string | number, today = lifeToday()) => {
  const cur = resolveRef(ref);
  if (!cur.recur) bad('task does not repeat');
  const nd = nextOccurrence({ ...cur.recur!, count: undefined }, cur.due_date ?? today, today, today);
  if (!nd) bad('series has ended');
  patch('tasks', cur.id, { due_date: nd });
  return need(getTask(cur.id), 'task');
};

export const reopenTask = (ref: string | number) => updateTask(ref, { status: 'open' });
export const deleteTask = (ref: string | number) => {
  const cur = resolveRef(ref);
  softDelete('tasks', cur.id);
  run(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL`, now(), now(), cur.id);
  return { id: cur.id, deleted: true };
};
export const restoreTask = (id: string) => {
  restore('tasks', id);
  run(`UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE parent_id = ?`, now(), id);
  return need(getTask(id), 'task');
};
export const purgeTasks = (days = 30) => purge('tasks', days);
/** Give a list of past-due tasks a new day in one go (the "Needs a day" button). */
export const setDay = (ids: string[], day: string | null) => {
  if (day !== null && !isDate(day)) bad('day must be YYYY-MM-DD');
  for (const id of ids) patch('tasks', resolveRef(id).id, { due_date: day });
  return ids.length;
};

// ---------- views ----------
export type ListOpts = { view?: View; project?: string; tag?: string; q?: string; limit?: number; today?: string; includeSubtasks?: boolean };
export const listTasks = (o: ListOpts = {}): TaskRow[] => {
  const d = o.today ?? lifeToday();
  const view = o.view ?? 'today';
  if (!VIEWS.includes(view)) bad(`view must be one of ${VIEWS.join(', ')}`);
  const where: string[] = [];
  const p: unknown[] = [];
  const open = `t.status = 'open' AND t.deleted_at IS NULL`;
  const started = `(t.start_date IS NULL OR t.start_date <= ?)`;
  switch (view) {
    case 'today': where.push(open, started, `(t.due_date = ? OR t.pinned = 1)`); p.push(d, d); break;
    case 'needs_day': where.push(open, `t.due_date < ?`); p.push(d); break;
    case 'upcoming': where.push(open, `t.due_date > ? AND t.due_date <= ?`); p.push(d, addDays(d, 14)); break;
    case 'inbox': where.push(open, started, `t.project_id IS NULL AND t.due_date IS NULL AND t.someday = 0 AND t.waiting_for IS NULL AND t.parent_id IS NULL`); p.push(d); break;
    case 'anytime': where.push(open, started, `t.due_date IS NULL AND t.someday = 0 AND t.waiting_for IS NULL`); p.push(d); break;
    case 'someday': where.push(open, `t.someday = 1`); break;
    case 'waiting': where.push(open, `t.waiting_for IS NOT NULL`); break;
    case 'done': where.push(`t.status IN ('done','dropped') AND t.deleted_at IS NULL AND t.done_at >= ?`); p.push(new Date(Date.now() - 30 * 86400000).toISOString()); break;
    case 'trash': where.push(`t.deleted_at IS NOT NULL`); break;
    case 'all': where.push(`t.deleted_at IS NULL`); break;
  }
  if (!o.includeSubtasks && !['inbox', 'trash'].includes(view)) where.push(`t.parent_id IS NULL`);
  if (o.project) { const pr = need(getProject(o.project), 'project'); where.push(`t.project_id = ?`); p.push(pr.id); }
  if (o.tag) { where.push(`EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)`); p.push(o.tag.replace(/^#/, '').toLowerCase()); }
  if (o.q) { where.push(`(t.title LIKE ? OR t.notes LIKE ?)`); p.push(`%${o.q}%`, `%${o.q}%`); }
  const order = view === 'done' ? `t.done_at DESC`
    : view === 'trash' ? `t.deleted_at DESC`
    : `t.pinned DESC, t.due_date IS NULL, t.due_date, t.due_time IS NULL, t.due_time, t.priority DESC, t.sort, t.created_at`;
  const limit = Math.min(Math.max(o.limit ?? 500, 1), 2000);
  return all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, ...p).map(hydrate);
};
export const subtasks = (id: string) => all(`${SELECT} WHERE t.parent_id = ? AND t.deleted_at IS NULL ORDER BY t.sort, t.created_at`, id).map(hydrate);

export const counts = (today = lifeToday()) => Object.fromEntries(
  (['today', 'needs_day', 'upcoming', 'inbox', 'waiting'] as View[]).map((v) => [v, listTasks({ view: v, today, limit: 2000 }).length]));

// Minutes until the next day anchor (meal or sleep) at an instant. Registered by the extras module (anchors live there),
// so this file does not import extras (extras imports tasks).
let anchorIn: ((at: Date) => number | null) | null = null;
export const setAnchorSource = (fn: ((at: Date) => number | null) | null) => { anchorIn = fn; };

export type WhatNowOpts = { at?: Date; mode?: string | null };
export type WhatNow = { task: TaskRow; first_action: string; minutes: number; reason: 'block' | 'pick' };
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/**
 * The one next action.
 * Pool: today (due today or pinned) + anytime. Overdue tasks never come back on their own (nothing rolls over).
 * 1. The task of the block running now (app task mirrored from a calendar block) wins.
 * 2. Else pinned → priority → smallest estimate → oldest, skipping tasks with a later time today.
 * Zero mode: only tasks of 10 minutes or less (or no estimate); the timer is capped at 10.
 * A task that would run into the next anchor is passed over while a shorter one fits.
 */
export const whatNow = (today = lifeToday(), o: WhatNowOpts = {}): WhatNow | null => {
  const at = o.at ?? new Date();
  const mode = o.mode ?? (one<{ v: string }>(`SELECT v FROM kv WHERE k = 'mode'`)?.v ?? 'Normal');
  const zero = mode === 'Zero';
  const live = lifeDay(at) === today;
  const nowMin = live ? toMin(hhmm(at)) : null;
  const seen = new Set<string>();
  const pool = [...listTasks({ view: 'today', today }), ...listTasks({ view: 'anytime', today, limit: 200 })]
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

  // 1. the block running now
  if (nowMin !== null) {
    const block = pool.find((t) => t.event_id && t.due_date === today && t.due_time
      && toMin(t.due_time) <= nowMin && nowMin < toMin(t.due_time) + (t.est_minutes ?? 50));
    if (block) {
      const left = toMin(block.due_time!) + (block.est_minutes ?? 50) - nowMin;
      const minutes = Math.max(5, zero ? Math.min(10, left) : left);
      return { task: block, first_action: block.first_action ?? `Open it and do the first 2 minutes: ${block.title}`, minutes, reason: 'block' };
    }
  }

  // 2. a pick
  let xs = pool.filter((t) => !(nowMin !== null && t.due_date === today && t.due_time && toMin(t.due_time) > nowMin));
  if (zero) xs = xs.filter((t) => t.est_minutes == null || t.est_minutes <= 10);
  const pin = (a: TaskRow, b: TaskRow) => Number(b.pinned) - Number(a.pinned) || b.priority - a.priority
    || (a.est_minutes ?? 999) - (b.est_minutes ?? 999) || a.created_at.localeCompare(b.created_at);
  const dated = xs.filter((t) => t.due_date === today || t.pinned).sort(pin);
  const free = xs.filter((t) => !(t.due_date === today || t.pinned)).sort(pin);
  let ordered = [...dated, ...free];
  const gap = live && anchorIn ? anchorIn(at) : null;
  if (gap != null) {
    const fits = ordered.filter((t) => (t.est_minutes ?? 10) <= gap);
    if (fits.length) ordered = fits;
  }
  const top = ordered[0];
  if (!top) return null;
  let minutes = top.est_minutes && top.est_minutes > 0 ? top.est_minutes : 10;
  if (zero) minutes = Math.min(10, minutes);
  return { task: top, first_action: top.first_action ?? `Open it and do the first 2 minutes: ${top.title}`, minutes, reason: 'pick' };
};

/**
 * Skip from Today = "not today". A one-off task moves to tomorrow; a recurring one jumps to its next occurrence.
 * Returns the task plus prev_due so the client can undo by restoring due_date.
 */
export const skipTask = (ref: string | number, today = lifeToday()) => {
  const cur = resolveRef(ref);
  const prev_due = cur.due_date;
  const task = cur.recur ? skipOccurrence(cur.id, today) : (patch('tasks', cur.id, { due_date: addDays(today, 1) }), need(getTask(cur.id), 'task'));
  return { ...task, prev_due };
};

/** Tasks done in the life-day's month (for the Done receipt). A count, never a score. */
export const doneThisMonth = (today = lifeToday()) => {
  const month = today.slice(0, 7);
  const since = new Date(zonedIso(`${month}-01`, '04:00')).toISOString();
  const n = one<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND deleted_at IS NULL AND done_at >= ?`, since)!.n;
  return { month, tasks: n };
};

/** Day load: planned minutes vs free work minutes (default 6 blocks × 50). Never judged, just shown. */
export const capacity = (day = lifeToday(), freeMinutes = 300) => {
  const ts = listTasks({ view: 'today', today: day });
  const planned = ts.reduce((s, t) => s + (t.est_minutes ?? 0), 0);
  return { day, planned_minutes: planned, free_minutes: freeMinutes, unestimated: ts.filter((t) => !t.est_minutes).length, tasks: ts.length };
};

// ---------- habits ----------
export const listHabits = (day = lifeToday()) => {
  const ws = weekStartOf(day);
  return all<Row>(`SELECT * FROM habits WHERE deleted_at IS NULL AND archived = 0 ORDER BY created_at`).map((h) => {
    const week = one<{ n: number }>(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND day >= ? AND day <= ? AND deleted_at IS NULL`, h.id, ws, addDays(ws, 6))!.n;
    const todayCount = one<{ n: number }>(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND day = ? AND deleted_at IS NULL`, h.id, day)!.n;
    return { ...h, archived: !!h.archived, this_week: week, today: todayCount };
  });
};
export const addHabit = (name: string, target_per_week = 7, id?: string) => {
  if (!Number.isInteger(target_per_week) || target_per_week < 1 || target_per_week > 7) bad('target_per_week must be 1–7');
  const row = { id: idOr(id), name: String(name).trim() || bad('name is required'), target_per_week };
  insert('habits', row);
  return one(`SELECT * FROM habits WHERE id = ?`, row.id);
};
/** Rename, change the weekly target, archive or restore. Archived habits drop out of listHabits. */
export const updateHabit = (ref: string, b: { name?: unknown; target_per_week?: unknown; archived?: unknown }) => {
  const h = findHabit(ref);
  const fields: Row = {};
  if (b.name !== undefined) fields.name = String(b.name).trim() || bad('name is required');
  if (b.target_per_week !== undefined) {
    const n = Number(b.target_per_week);
    if (!Number.isInteger(n) || n < 1 || n > 7) bad('target_per_week must be 1–7');
    fields.target_per_week = n;
  }
  if (b.archived !== undefined) fields.archived = b.archived ? 1 : 0;
  patch('habits', h.id, fields);
  const r = one<Row>(`SELECT * FROM habits WHERE id = ?`, h.id)!;
  const day = lifeToday();
  const ws = weekStartOf(day);
  const week = one<{ n: number }>(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND day >= ? AND day <= ? AND deleted_at IS NULL`, h.id, ws, addDays(ws, 6))!.n;
  const todayCount = one<{ n: number }>(`SELECT COALESCE(SUM(count),0) AS n FROM habit_checks WHERE habit_id = ? AND day = ? AND deleted_at IS NULL`, h.id, day)!.n;
  return { ...r, archived: !!r.archived, this_week: week, today: todayCount };
};
export const findHabit = (ref: string) => need(one<Row & { id: string }>(
  `SELECT * FROM habits WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref), `habit ${ref}`);
/** Set a day's check (count 0 removes it). Idempotent per (habit, day). */
export const checkHabit = (ref: string, day = lifeToday(), count = 1) => {
  const h = findHabit(ref);
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  if (count <= 0) { run(`DELETE FROM habit_checks WHERE habit_id = ? AND day = ?`, h.id, day); return { habit_id: h.id, day, count: 0 }; }
  const t = now();
  run(`INSERT INTO habit_checks (id, habit_id, day, count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (habit_id, day) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at, deleted_at = NULL`, uuid(), h.id, day, count, t, t);
  return { habit_id: h.id, day, count };
};

// ---------- goals ----------
export const listGoals = (status = 'active') => all<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND (? = 'all' OR status = ?) ORDER BY target_date IS NULL, target_date`, status, status)
  .map((g) => {
    const last = one<{ day: string; value: number }>(`SELECT day, value FROM goal_values WHERE goal_id = ? ORDER BY day DESC LIMIT 1`, g.id);
    const open = one<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE goal_id = ? AND status = 'open' AND deleted_at IS NULL`, g.id)!.n;
    return { ...g, current: last?.value ?? null, current_day: last?.day ?? null, open_tasks: open };
  });
export const addGoal = (g: { id?: string; name: string; why?: string; target_value?: number; unit?: string; target_date?: string; source_kind?: string; source_ref?: string }) => {
  if (g.target_date && !isDate(g.target_date)) bad('target_date must be YYYY-MM-DD');
  const row = { ...g, id: idOr(g.id), name: String(g.name).trim() || bad('name is required') };
  insert('goals', row);
  return one(`SELECT * FROM goals WHERE id = ?`, row.id);
};
export const setGoalValue = (id: string, value: number, day = lifeToday()) => {
  need(one(`SELECT id FROM goals WHERE id = ?`, id), 'goal');
  run(`INSERT INTO goal_values (goal_id, day, value) VALUES (?, ?, ?) ON CONFLICT (goal_id, day) DO UPDATE SET value = excluded.value`, id, day, value);
  return { goal_id: id, day, value };
};

// ---------- focus ----------
export const logFocus = (task_id: string | null, minutes: number, started_at = now(), id?: string, paused_ms = 0, pause_reason: string | null = null) => {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) bad('minutes must be 1–600');
  const pm = Number.isFinite(paused_ms) && paused_ms > 0 ? Math.round(paused_ms) : 0;
  const row = { id: idOr(id), task_id: task_id ? resolveRef(task_id).id : null, started_at, minutes: Math.round(minutes),
    paused_ms: pm, pause_reason: pm && pause_reason ? String(pause_reason).slice(0, 20) : null };
  insert('focus_sessions', row);
  return row;
};

// ---------- importers ----------
/** Task-app backup CSV → tasks + vault notes. Lives in taskcsv.ts. */
export { importTaskCsv } from './taskcsv.ts';

/** All tasks as rows for CSV export. */
export const exportTasks = () => all(`${SELECT} WHERE t.deleted_at IS NULL ORDER BY t.created_at`).map((r) => {
  const t = hydrate(r);
  return { id: t.id, title: t.title, project: t.project_name ?? '', status: t.status, priority: t.priority, tags: t.tags.join(' '),
    start_date: t.start_date ?? '', due_date: t.due_date ?? '', due_time: t.due_time ?? '', est_minutes: t.est_minutes ?? '',
    repeat: t.recur_text ?? '', done_at: t.done_at ?? '', notes: t.notes };
});

/** Shape for MCP tasks_* compatibility (Phase 1 output keys). */
export const compat = (t: TaskRow) => ({
  id: t.id, uuid: t.id, title: t.title, description: t.notes, done: t.status === 'done',
  doneAt: t.done_at, due: t.due_date ? (t.due_time ? zonedIso(t.due_date, t.due_time) : t.due_date) : null,
  priority: t.priority, projectTitle: t.project_name ?? 'Inbox', tags: t.tags, est_minutes: t.est_minutes, repeat: t.recur_text,
});
