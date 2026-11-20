// Brainstorm round 1: curiosity queue, gap filler, duplicate catcher, inbox compost, triage 5, weekday layout.
// Rules: no streaks, no guilt words, nothing pushed. Business questions stay out of the curiosity queue.
import { AppError } from '../../errors.ts';
import { kvGet, kvSet } from '../../db.ts';
import { captureNote } from '../../notes.ts';
import { TZ, dateOf, dowOf, lifeDay, lifeToday } from '../../time.ts';
import { all, one, run, patch, need, now, idOr, insert, j } from '../util.ts';
import type { Row } from '../util.ts';
import * as tasks from '../tasks/store.ts';
import { nextAnchor } from '../extras/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };

// =====================================================================================================
// Text helpers
// =====================================================================================================
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'with', 'my', 'is', 'it',
  'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et']);
export const normalise = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const tokens = (s: string) => [...new Set(normalise(s).split(' ').filter((t) => t.length >= 2 && !STOP.has(t)))];
export const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((t) => B.has(t)).length;
  return inter / (a.length + b.length - inter);
};

// =====================================================================================================
// 1. Curiosity queue: park a question, the nightly run answers up to 5 into the Log.
// =====================================================================================================
export type Question = { id: string; text: string; status: 'open' | 'answered' | 'dropped'; answer_md: string | null;
  answered_at: string | null; created_at: string; updated_at: string };

export const addQuestion = (text: string, id?: string): Question & { duplicate?: boolean } => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) bad('question is too short');
  if (t.length > 300) bad('question max 300 characters');
  const key = normalise(t);
  const dupe = all<Question & { k?: string }>(`SELECT * FROM questions WHERE deleted_at IS NULL AND status != 'dropped'`)
    .find((q) => normalise(q.text) === key);
  if (dupe) return { ...dupe, duplicate: true };
  const row = { id: idOr(id), text: t, status: 'open' };
  insert('questions', row);
  return need(one<Question>(`SELECT * FROM questions WHERE id = ?`, row.id), 'question');
};

export const listQuestions = (status?: string, limit = 50) => {
  if (status && !['open', 'answered', 'dropped'].includes(status)) bad('status must be open, answered or dropped');
  return all<Question>(`SELECT * FROM questions WHERE deleted_at IS NULL ${status ? 'AND status = ?' : ''}
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(answered_at, created_at) DESC LIMIT ?`,
    ...(status ? [status, Math.min(limit, 200)] : [Math.min(limit, 200)]));
};

/** Oldest open questions first, for the nightly run (max 5). */
export const openQuestions = (limit = 5) =>
  all<Question>(`SELECT * FROM questions WHERE deleted_at IS NULL AND status = 'open' ORDER BY created_at LIMIT ?`, Math.min(Math.max(limit, 1), 5));

export const answerQuestion = async (id: string, answer_md: string) => {
  const q = need(one<Question>(`SELECT * FROM questions WHERE id = ? AND deleted_at IS NULL`, id), 'question');
  const a = String(answer_md ?? '').trim();
  if (!a) bad('answer is required');
  if (a.length > 4000) bad('answer max 4000 characters');
  patch('questions', id, { status: 'answered', answer_md: a, answered_at: now() });
  try { await captureNote(`Q: ${q.text}\n\n${a}`); } catch { /* vault offline: the answer is still in the app */ }
  return need(one<Question>(`SELECT * FROM questions WHERE id = ?`, id), 'question');
};

export const updateQuestion = (id: string, f: { status?: string; text?: string }) => {
  need(one(`SELECT id FROM questions WHERE id = ? AND deleted_at IS NULL`, id), 'question');
  const row: Row = {};
  if (f.status !== undefined) {
    if (!['open', 'dropped'].includes(f.status)) bad('status must be open or dropped (answers go through answer)');
    row.status = f.status;
  }
  if (f.text !== undefined) {
    const t = String(f.text).replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 300) bad('question must be 3–300 characters');
    row.text = t;
  }
  patch('questions', id, row);
  return need(one<Question>(`SELECT * FROM questions WHERE id = ?`, id), 'question');
};

// =====================================================================================================
// 2. Gap filler: tasks that fit before the next anchor.
// =====================================================================================================
const REST_FROM = 23 * 60; // wind-down starts
const REST_UNTIL = 10 * 60 + 30; // wake
const minsOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const localMinutes = (at: Date) => {
  const s = at.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return minsOf(s);
};

export const fits = (at = new Date()) => {
  const mode = kvGet('mode') ?? 'Normal';
  const day = dateOf(at);
  const anchor = nextAnchor(at);
  const empty = (reason: string) => ({ gap_min: anchor?.in_minutes ?? null, anchor, tasks: [] as tasks.TaskRow[], reason });
  if (mode === 'Zero' || mode === 'Family') return empty(`${mode} mode`);
  if (dowOf(day) === 6) return empty('Saturday');
  if (!anchor) return empty('no anchor');
  const nowMin = localMinutes(at);
  if (nowMin >= REST_FROM || nowMin < REST_UNTIL) return empty('rest hours');
  const gap = anchor.in_minutes;
  if (gap < 5) return empty('gap under 5 min');
  const budget = gap - 3;
  const today = lifeDay(at);
  const seen = new Set<string>();
  const pool = [...tasks.listTasks({ view: 'today', today }), ...tasks.listTasks({ view: 'needs_day', today }),
    ...tasks.listTasks({ view: 'anytime', today, limit: 300 })]
    .filter((t) => !seen.has(t.id) && seen.add(t.id) && t.est_minutes != null && t.est_minutes > 0 && t.est_minutes <= budget);
  pool.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.priority - a.priority || (b.est_minutes ?? 0) - (a.est_minutes ?? 0));
  return { gap_min: gap, anchor, tasks: pool.slice(0, 3), reason: null };
};

// =====================================================================================================
// 3. Duplicate catcher
// =====================================================================================================
export const similarTasks = (title: string, exceptId?: string, threshold = 0.6) => {
  const tk = tokens(title);
  if (tk.length < 3) return [];
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  return all<Row>(`SELECT id, title, due_date, project_id FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND recur IS NULL
      AND created_at >= ? AND id != ?`, since, exceptId ?? '')
    .map((r) => ({ id: String(r.id), title: String(r.title), due_date: (r.due_date as string) ?? null, score: jaccard(tk, tokens(String(r.title))) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }));
};

/** Keep `keep`, drop `drop` (status dropped, note added). Notes and tags merge into the kept task. */
export const mergeTasks = (keep: string, drop: string) => {
  if (keep === drop) bad('cannot merge a task into itself');
  const k = tasks.resolveRef(keep);
  const d = tasks.resolveRef(drop);
  const notes = [k.notes, d.notes && d.notes !== k.notes ? d.notes : null].filter(Boolean).join('\n\n') || null;
  tasks.updateTask(k.id, { tags: [...new Set([...k.tags, ...d.tags])], notes,
    est_minutes: k.est_minutes ?? d.est_minutes ?? undefined, due_date: k.due_date ?? d.due_date ?? undefined } as tasks.TaskInput);
  tasks.updateTask(d.id, { status: 'dropped', notes: `${d.notes ? `${d.notes}\n\n` : ''}Merged into: ${k.title}` } as tasks.TaskInput);
  return tasks.getTask(k.id);
};

// =====================================================================================================
// 4. Inbox compost: inbox items untouched for 30 days move to Someday with the tag `composted`.
// =====================================================================================================
export const COMPOST_DAYS = 30;
export const compost = (at = new Date(), days = COMPOST_DAYS, dryRun = false) => {
  const cut = new Date(at.getTime() - days * 86400000).toISOString();
  const rows = all<Row>(`SELECT id, title, tags FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND project_id IS NULL
      AND due_date IS NULL AND someday = 0 AND waiting_for IS NULL AND parent_id IS NULL AND pinned = 0 AND recur IS NULL
      AND updated_at < ?`, cut);
  if (!dryRun) {
    for (const r of rows) {
      const tg = [...new Set([...j<string[]>(r.tags, []), 'composted'])];
      run(`UPDATE tasks SET someday = 1, tags = ?, updated_at = ? WHERE id = ?`, JSON.stringify(tg), now(), r.id);
    }
  }
  return { moved: rows.length, titles: rows.slice(0, 20).map((r) => String(r.title)), dry_run: dryRun };
};
export const composted = () => tasks.listTasks({ view: 'someday', tag: 'composted' });
export const restoreComposted = (ref: string) => {
  const t = tasks.resolveRef(ref);
  return tasks.updateTask(t.id, { someday: false, tags: t.tags.filter((x) => x !== 'composted') });
};

// =====================================================================================================
// 6. Triage 5: oldest inbox items, one decision each. Max 1 Inbox item moved to a project per day.
// =====================================================================================================
const promoKey = (day: string) => `promoted:${day}`;
export const triage = (today = lifeToday()) => {
  const rows = all<Row>(`SELECT id FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND project_id IS NULL AND due_date IS NULL
      AND someday = 0 AND waiting_for IS NULL AND parent_id IS NULL AND (start_date IS NULL OR start_date <= ?)
      ORDER BY updated_at, created_at LIMIT 5`, today);
  const promoted = kvGet(promoKey(today));
  return {
    items: rows.map((r) => tasks.getTask(String(r.id))).filter(Boolean),
    inbox_total: one<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'open' AND deleted_at IS NULL AND project_id IS NULL
      AND due_date IS NULL AND someday = 0 AND waiting_for IS NULL AND parent_id IS NULL`)!.n,
    promoted_today: promoted ? JSON.parse(promoted) : null,
  };
};

export type TriageAction = 'project' | 'someday' | 'trash' | 'keep';
export const triageDecide = (ref: string, action: TriageAction, o: { project?: string; urgent?: boolean } = {}, today = lifeToday()) => {
  const t = tasks.resolveRef(ref);
  switch (action) {
    case 'project': {
      if (!o.project) bad('project is required');
      const prev = kvGet(promoKey(today));
      if (prev && !o.urgent) {
        throw new AppError('conflict', `One move a day: "${JSON.parse(prev).title}" already went to a project today. Keep this one for tomorrow, or mark it urgent.`);
      }
      const r = tasks.updateTask(t.id, { project: o.project } as tasks.TaskInput);
      if (!prev) kvSet(promoKey(today), JSON.stringify({ id: t.id, title: t.title }));
      return { action, task: r };
    }
    case 'someday': return { action, task: tasks.updateTask(t.id, { someday: true }) };
    case 'trash': tasks.deleteTask(t.id); return { action, task: null };
    case 'keep': run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, now(), t.id); return { action, task: tasks.getTask(t.id) };
    default: return bad('action must be project, someday, trash or keep');
  }
};

// =====================================================================================================
// 7. Fixed weekday layout (report only, never moves anything).
// =====================================================================================================
export const LAYOUT: { block: string; from: string; to: string; writable: boolean }[] = [
  { block: '🗂️ Admin', from: '11:30', to: '12:20', writable: true },
  { block: '🛠️ Project work', from: '13:10', to: '14:00', writable: true },
  { block: '🧠 Deep work', from: '15:30', to: '16:20', writable: true },
  { block: '📞 Meetings', from: '16:30', to: '17:20', writable: true },
  { block: '🍽️ Dinner + family', from: '18:00', to: '19:00', writable: false },
  { block: '🏋️ Gym', from: '19:30', to: '20:45', writable: false },
  { block: '📚 Learning', from: '20:50', to: '21:25', writable: true },
  { block: '🧹 Buffer', from: '21:30', to: '22:20', writable: true },
];
type LayoutBlock = { block: string; from: string; to: string; writable: boolean };
// Friday: Project work moves to 14:10–15:00.
const FRIDAY_LAYOUT: LayoutBlock[] = LAYOUT.map((b) => b.block === '🛠️ Project work' ? { ...b, from: '14:10', to: '15:00' } : b);
// Sunday: Weekly review 12:00–14:30 plus Gym.
const SUNDAY_LAYOUT: LayoutBlock[] = [
  { block: '🗓️ Weekly review', from: '12:00', to: '14:30', writable: true },
  ...LAYOUT.filter((b) => b.block === '🏋️ Gym'),
];
export const layoutFor = (day: string): { kind: 'weekday' | 'friday' | 'sunday' | 'rest'; blocks: LayoutBlock[] } => {
  const dow = dowOf(day);
  if (dow === 6) return { kind: 'rest', blocks: [] };
  if (dow === 0) return { kind: 'sunday', blocks: SUNDAY_LAYOUT };
  if (dow === 5) return { kind: 'friday', blocks: FRIDAY_LAYOUT };
  return { kind: 'weekday', blocks: LAYOUT };
};
