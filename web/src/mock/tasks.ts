// Mock /api/v2 tasks, projects, habits, v1 goals, asks, questions, triage, compost and park.
import type {
  Ask,
  Capacity,
  CompostRun,
  Counts,
  Estimates,
  EstimateHint,
  Fits,
  Goal,
  Habit,
  Question,
  Similar,
  Triage,
  TriageAction,
  V2Project,
  V2Task,
  V2View,
  WhatNow,
} from '../v2';
import {
  addDays,
  at,
  bad,
  created,
  dow,
  idOf,
  iso,
  match,
  notFound,
  num,
  ok,
  optNum,
  str,
  today,
  uid,
  weekStart,
  type Ctx,
  type Res,
} from './util';

// ---------- projects ----------

type ProjectRow = { id: string; name: string; status: string; emoji: string | null };
export const projects: ProjectRow[] = [
  { id: 'p_site', name: 'Studio', status: 'active', emoji: '💼' },
  { id: 'p_learning', name: 'Learning', status: 'active', emoji: '📚' },
  { id: 'p_admin', name: 'Admin', status: 'active', emoji: '🗂️' },
  { id: 'p_personal', name: 'Personal', status: 'active', emoji: '🏠' },
];

/** "Studio", "studio", "p_site" → project row. "Inbox" and null → null (inbox = no project). */
function projectOf(ref: unknown): ProjectRow | null {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const r = ref.trim().toLowerCase();
  if (r === 'inbox') return null;
  let p = projects.find((x) => x.id === ref || x.name.toLowerCase() === r);
  if (!p) {
    p = { id: uid('p'), name: ref.trim(), status: 'active', emoji: null };
    projects.push(p);
  }
  return p;
}

// ---------- tasks ----------

export const tasks: V2Task[] = [];
let sortSeq = 0;

function mkTask(f: Partial<V2Task> & { title: string }, projectName?: string | null): V2Task {
  const p = projectName === undefined ? null : projectOf(projectName);
  const t: V2Task = {
    id: f.id ?? uid('t'),
    notes: '',
    project_id: p?.id ?? null,
    parent_id: null,
    section: null,
    status: 'open',
    priority: 0,
    tags: [],
    start_date: null,
    due_date: null,
    due_time: null,
    est_minutes: null,
    first_action: null,
    done_def: null,
    recur: null,
    pinned: false,
    waiting_for: null,
    someday: false,
    goal_id: null,
    source: 'app',
    event_id: null,
    sort: ++sortSeq,
    done_at: null,
    deleted_at: null,
    project_name: p?.name ?? null,
    recur_text: null,
    ...f,
  };
  if (p) {
    t.project_id = p.id;
    t.project_name = p.name;
  }
  return t;
}

function seedTasks() {
  const d = today();
  const add = (f: Partial<V2Task> & { title: string }, project?: string | null) => tasks.push(mkTask(f, project));
  add({ title: 'Design the portfolio case study layout', due_date: d, due_time: '15:30', est_minutes: 50, priority: 3, pinned: true, tags: ['portfolio'],
    first_action: 'Open the case study file', done_def: 'Layout for 3 sections drawn', source: 'block' }, 'Studio');
  add({ title: 'Reply to 3 emails, 1 call', due_date: d, due_time: '16:30', est_minutes: 50, priority: 3, tags: ['email'],
    first_action: 'Open the inbox', done_def: 'Inbox zero + call notes saved', source: 'block' }, 'Studio');
  add({ title: 'Finish the recipe app home page', due_date: d, due_time: '13:10', est_minutes: 50, priority: 3, tags: ['build'],
    first_action: 'Open the home page draft', done_def: 'Page works on the phone', source: 'block',
    status: 'done', done_at: iso(Date.now() - 2 * 3600000) }, 'Studio');
  add({ title: 'Sort the receipts folder', due_date: d, due_time: '11:30', est_minutes: 45, tags: ['admin'],
    first_action: 'Open the receipts folder', done_def: 'Folder sorted by month' }, 'Admin');
  add({ title: 'Course: lesson 35', due_date: addDays(d, 1), est_minutes: 30, tags: ['learning'],
    first_action: 'Open lesson 35', done_def: 'Lesson watched, 3 notes written' }, 'Learning');
  add({ title: 'Renew portfolio domain', due_date: addDays(d, -1), est_minutes: 10, tags: ['admin'],
    first_action: 'Open the registrar dashboard', done_def: 'Renewal receipt saved' }, 'Admin');
  add({ title: 'Draft case study from the recipe app', due_date: addDays(d, 2), est_minutes: 40, priority: 2 }, 'Studio');
  add({ title: 'Back up project files', due_date: addDays(d, (4 - dow(d) + 7) % 7 || 7), est_minutes: 30, tags: ['admin'],
    recur: 'FREQ=WEEKLY;BYDAY=TH', recur_text: 'every Thursday' }, 'Studio');
  add({ title: 'Quarterly tax form check', due_date: addDays(d, 9), est_minutes: 20 }, 'Admin');
  add({ title: 'Book barber', est_minutes: 5 }, 'Personal');
  add({ title: 'Clean laptop keyboard', est_minutes: 10 }, 'Personal');
  add({ title: 'Idea: a weekly meal-plan printout' });
  add({ title: 'Ask cousin about used hatchback prices' });
  add({ title: 'Watch a CSS grid talk', tags: ['learn'] });
  add({ title: 'Learn Arabic calligraphy', someday: true }, 'Personal');
  add({ title: 'Logo files from Nour', waiting_for: 'Nour sends the SVGs', est_minutes: 15 }, 'Studio');
  add({ title: 'Pay the phone bill', status: 'done', done_at: iso(Date.now() - 26 * 3600000), tags: ['admin'] }, 'Admin');
  add({ title: 'Old idea: TikTok ads test', deleted_at: iso(Date.now() - 3 * 86400000) });
}
seedTasks();

const live = (t: V2Task) => !t.deleted_at;
const open = (t: V2Task) => live(t) && t.status === 'open';

export function listTasks(view: V2View, project?: string | null, query?: string | null): V2Task[] {
  const d = today();
  const limit = addDays(d, 14);
  const monthAgo = Date.now() - 30 * 86400000;
  let list = tasks.filter((t) => {
    switch (view) {
      case 'today': return open(t) && (t.due_date === d || t.pinned);
      case 'needs_day': return open(t) && !!t.due_date && t.due_date < d;
      case 'upcoming': return open(t) && !!t.due_date && t.due_date > d && t.due_date <= limit;
      case 'inbox': return open(t) && !t.project_id && !t.due_date && !t.someday && !t.waiting_for;
      case 'anytime': return open(t) && !t.due_date && !t.someday && !t.waiting_for;
      case 'someday': return open(t) && t.someday;
      case 'waiting': return open(t) && !!t.waiting_for;
      case 'done': return live(t) && t.status !== 'open' && !!t.done_at && Date.parse(t.done_at) >= monthAgo;
      case 'trash': return !!t.deleted_at;
      default: return live(t);
    }
  });
  if (project) {
    const r = project.toLowerCase();
    list = r === 'inbox' ? list.filter((t) => !t.project_id) : list.filter((t) => t.project_id === project || t.project_name?.toLowerCase() === r);
  }
  if (query) {
    const s = query.toLowerCase();
    list = list.filter((t) => t.title.toLowerCase().includes(s) || t.notes.toLowerCase().includes(s));
  }
  if (view === 'done') return list.sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  if (view === 'trash') return list.sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
  return list.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    (a.due_date ?? '9').localeCompare(b.due_date ?? '9') ||
    (a.due_time ?? '99').localeCompare(b.due_time ?? '99') ||
    b.priority - a.priority ||
    a.sort - b.sort);
}

export const counts = (): Counts => ({
  today: listTasks('today').length,
  needs_day: listTasks('needs_day').length,
  upcoming: listTasks('upcoming').length,
  inbox: listTasks('inbox').length,
  waiting: listTasks('waiting').length,
});

export function whatNow(): WhatNow {
  const pool = [...listTasks('today'), ...listTasks('needs_day')];
  pool.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.priority - a.priority || (a.est_minutes ?? 999) - (b.est_minutes ?? 999));
  const t = pool[0];
  if (!t) return null;
  const minutes = t.est_minutes && t.est_minutes > 0 ? t.est_minutes : 10;
  return { task: { ...t }, first_action: t.first_action ?? `Open it and do the first 2 minutes: ${t.title}`, minutes, reason: 'pick' };
}

export function capacity(free = 300): Capacity {
  const list = listTasks('today');
  const planned = list.reduce((s, t) => s + (t.est_minutes ?? 0), 0);
  return { day: today(), planned_minutes: planned, free_minutes: Math.max(0, free - planned), unestimated: list.filter((t) => t.est_minutes == null).length, tasks: list.length };
}

function findTask(ref: string): V2Task | undefined {
  return tasks.find((t) => t.id === ref) ?? tasks.find((t) => t.title.toLowerCase() === ref.toLowerCase());
}

/** Tiny quick-add parser: "#project", "today"/"tomorrow", "30m", "!" priority. */
function parseQuick(text: string): Partial<V2Task> & { title: string; project?: string } {
  let title = text.trim();
  const out: Partial<V2Task> & { title: string; project?: string } = { title };
  const proj = /(?:^|\s)#([\w-]+(?:\s[\w-]+)?)/.exec(title);
  if (proj) {
    const name = proj[1]!.replace(/-/g, ' ');
    const hit = projects.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.name.toLowerCase().startsWith(name.toLowerCase()));
    out.project = hit?.name ?? name;
    title = title.replace(proj[0], ' ');
  }
  if (/\btoday\b/i.test(title)) { out.due_date = today(); title = title.replace(/\btoday\b/i, ' '); }
  else if (/\btomorrow\b/i.test(title)) { out.due_date = addDays(today(), 1); title = title.replace(/\btomorrow\b/i, ' '); }
  const est = /\b(\d{1,3})\s?m(?:in)?\b/i.exec(title);
  if (est) { out.est_minutes = Number(est[1]); title = title.replace(est[0], ' '); }
  if (/(^|\s)!+(\s|$)/.test(title)) { out.priority = 3; title = title.replace(/(^|\s)!+(\s|$)/, ' '); }
  out.title = title.replace(/\s+/g, ' ').trim() || text.trim();
  return out;
}

function similarTo(title: string, except?: string): Similar[] {
  const words = new Set(title.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!words.size) return [];
  return tasks
    .filter((t) => open(t) && t.id !== except)
    .map((t) => {
      const tw = t.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const hits = tw.filter((w) => words.has(w)).length;
      return { id: t.id, title: t.title, due_date: t.due_date, score: hits / Math.max(words.size, tw.length || 1) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** A copy of the body without some keys (so `'key' in b` stays false for them). */
const without = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(b).filter(([k]) => !keys.includes(k)));

function applyInput(t: V2Task, b: Record<string, unknown>) {
  if (typeof b.title === 'string') t.title = b.title;
  if (typeof b.notes === 'string') t.notes = b.notes;
  if ('project' in b) {
    const p = projectOf(b.project);
    t.project_id = p?.id ?? null;
    t.project_name = p?.name ?? null;
  }
  if ('due_date' in b) t.due_date = (b.due_date as string | null) ?? null;
  if ('due_time' in b) t.due_time = (b.due_time as string | null) ?? null;
  if ('est_minutes' in b) t.est_minutes = optNum(b.est_minutes);
  if ('first_action' in b) t.first_action = (b.first_action as string | null) ?? null;
  if ('done_def' in b) t.done_def = (b.done_def as string | null) ?? null;
  if (typeof b.priority === 'number') t.priority = b.priority;
  if (typeof b.pinned === 'boolean') t.pinned = b.pinned;
  if (typeof b.someday === 'boolean') t.someday = b.someday;
  if ('waiting_for' in b) t.waiting_for = (b.waiting_for as string | null) || null;
  if (Array.isArray(b.tags)) t.tags = b.tags.map(String);
}

// ---------- focus log (for done counts + estimates) ----------

export const focusLog: { task_id: string; minutes: number; day: string }[] = [
  { task_id: 'seed', minutes: 50, day: today() },
  { task_id: 'seed', minutes: 25, day: today() },
];

// ---------- habits ----------

type HabitRow = { id: string; name: string; target_per_week: number; archived: boolean };
export const habits: HabitRow[] = [
  { id: 'h_launch', name: 'Kickoff on time', target_per_week: 5, archived: false },
  { id: 'h_read', name: 'Read 10 pages', target_per_week: 7, archived: false },
  { id: 'h_gym', name: 'Gym', target_per_week: 4, archived: false },
  { id: 'h_stretch', name: 'Stretch 10 min', target_per_week: 5, archived: false },
  { id: 'h_walk', name: 'Walk after dinner', target_per_week: 3, archived: false },
];
/** day → habit id → count */
export const habitChecks = new Map<string, Map<string, number>>();
function seedChecks() {
  const d = today();
  const ws = weekStart(d);
  const seed: Record<string, number[]> = { h_launch: [0, 1, 2], h_read: [0, 1, 2, 3], h_gym: [0, 2], h_stretch: [1], h_walk: [0] };
  for (const [h, offs] of Object.entries(seed)) {
    for (const o of offs) {
      const day = addDays(ws, o);
      if (day > d) continue;
      const m = habitChecks.get(day) ?? new Map<string, number>();
      m.set(h, 1);
      habitChecks.set(day, m);
    }
  }
}
seedChecks();

export function habitView(h: HabitRow, day = today()): Habit {
  const ws = weekStart(day);
  let week = 0;
  for (let i = 0; i < 7; i++) week += habitChecks.get(addDays(ws, i))?.get(h.id) ?? 0;
  return { ...h, this_week: week, today: habitChecks.get(day)?.get(h.id) ?? 0 };
}
export const listHabits = (day = today()) => habits.filter((h) => !h.archived).map((h) => habitView(h, day));
export const habitChecksOn = (day: string) => [...(habitChecks.get(day)?.values() ?? [])].reduce((s, n) => s + n, 0);

// ---------- v1 goals ----------

export const goalsV1: Goal[] = [
  { id: 'g_car', name: 'Savings fund: used car', why: 'Pay for a car in cash.', target_value: 9000, unit: 'USD', target_date: addDays(today(), 210), status: 'active', current: 2350, current_day: today(), open_tasks: 1 },
  { id: 'g_run', name: 'Run a 10k', why: 'Steady energy for long days.', target_value: 3, unit: 'practice runs', target_date: addDays(today(), 100), status: 'active', current: 0, current_day: null, open_tasks: 6 },
  { id: 'g_jobs', name: 'Read 12 books', why: 'One book a month.', target_value: 12, unit: 'books', target_date: addDays(today(), 300), status: 'active', current: 5, current_day: addDays(today(), -1), open_tasks: 1 },
];

// ---------- asks ----------

export const asks: Ask[] = [
  { id: 'a_wake', key: 'profile.wake_time', module: 'profile', question: 'What time do you usually wake up on weekdays?', why: 'Plans the Kickoff block.', answer_type: 'choice', options: ['06:00', '06:30', '07:00', '07:30'], priority: 3, status: 'open' },
  { id: 'a_height', key: 'body.height_cm', module: 'body', question: 'How tall are you, in cm?', why: 'Food targets use it.', answer_type: 'number', options: [], priority: 2, status: 'open' },
  { id: 'a_focus_hard', key: 'focus.hardest_time', module: 'focus', question: 'Hardest time of day to start things?', why: 'The planner keeps hard tasks out of that slot.', answer_type: 'choice', options: ['morning', 'afternoon', 'evening', 'night'], priority: 2, status: 'open' },
  { id: 'a_focus_remind', key: 'focus.reminder_style', module: 'focus', question: 'Reminder style?', why: '"none" stops the weekly goal check-in card.', answer_type: 'choice', options: ['few', 'normal', 'none'], priority: 2, status: 'open' },
  { id: 'a_coffee', key: 'food.coffee_usual', module: 'food', question: 'What is your usual coffee order?', why: 'One-tap logging.', answer_type: 'text', options: [], priority: 1, status: 'open' },
  { id: 'a_conf', key: 'goals.confidence.g_car', module: 'goals', question: 'How sure are you the savings fund lands on time? (1–5)', why: 'Tracks pace honestly.', answer_type: 'choice', options: ['1', '2', '3', '4', '5'], priority: 1, status: 'open' },
];
export const openAsks = (n: number) => asks.filter((a) => a.status === 'open').sort((a, b) => b.priority - a.priority).slice(0, n);

// ---------- questions ----------

const questions: Question[] = [
  { id: 'q_1', text: 'Should the recipe app store data offline first?', status: 'open', answer_md: null, answered_at: null, created_at: iso(Date.now() - 2 * 86400000) },
  { id: 'q_2', text: 'Which hosting plan covers 3 side projects?', status: 'answered', answer_md: 'A shared plan with 3 sites. Check the pricing page before buying.', answered_at: iso(Date.now() - 86400000), created_at: iso(Date.now() - 4 * 86400000) },
];

// ---------- compost ----------

const composted: V2Task[] = [];
const COMPOST_DAYS = 60;
function compostPreview(): CompostRun {
  const stale = tasks.filter((t) => open(t) && !t.project_id && !t.due_date && t.sort <= 3);
  return { moved: stale.length, titles: stale.map((t) => t.title), dry_run: true };
}

// ---------- triage ----------

let promotedToday: { id: string; title: string } | null = null;
let promotedDay = '';

// ---------- park ----------

const parked: V2Task[] = [
  mkTask({ title: 'Look into a cheaper phone plan', tags: ['parked'], source: 'park', someday: true }),
];

// ---------- estimates ----------

const estimates = (): Estimates => ({
  overall: { n: 18, ratio: 1.3 },
  by_tag: [
    { tag: 'email', n: 8, ratio: 1.1 },
    { tag: 'build', n: 6, ratio: 1.6 },
    { tag: 'admin', n: 4, ratio: 1.2 },
  ],
  min_samples: 3,
  note: 'Ratio = actual / estimate from timed focus sessions. Estimates only.',
});

// ---------- router ----------

export function handleTasks(c: Ctx): Res | null {
  const { route, qp, b } = c;
  let m: string[] | null;

  if (route === 'GET /tasks') return ok(listTasks((qp.get('view') ?? 'all') as V2View, qp.get('project'), qp.get('q')));
  if (route === 'GET /tasks/counts') return ok(counts());
  if (route === 'GET /done/month') {
    const month = today().slice(0, 7);
    return ok({ month, tasks: tasks.filter((t) => t.status === 'done' && !t.deleted_at && (t.done_at ?? '').slice(0, 7) === month).length });
  }
  if (route === 'GET /tasks/now') return ok({ what_now: whatNow(), capacity: capacity(num(qp.get('free'), 300)) });
  if (route === 'POST /tasks') {
    const id = idOf(b, 't');
    const dup = tasks.find((t) => t.id === id);
    if (dup) return ok({ ...dup, similar: [] });
    let t: V2Task;
    if (typeof b.text === 'string') {
      const parsed = parseQuick(b.text);
      const projectName = 'project' in b ? (b.project as string | null) : parsed.project ?? null;
      delete parsed.project;
      t = mkTask({ ...parsed, id }, projectName);
      applyInput(t, without(b, ['title', 'project', 'id', 'text']));
      if ('project' in b) {
        const p = projectOf(b.project);
        t.project_id = p?.id ?? null;
        t.project_name = p?.name ?? null;
      }
    } else {
      const title = str(b.title).trim();
      if (!title) return bad('Title is required.');
      t = mkTask({ id, title }, (b.project as string | null | undefined) ?? null);
      applyInput(t, without(b, ['project']));
    }
    const similar = similarTo(t.title);
    tasks.push(t);
    return created({ ...t, similar });
  }
  if (route === 'POST /tasks/set-day') {
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    let n = 0;
    for (const id of ids) {
      const t = findTask(id);
      if (t) { t.due_date = (b.day as string | null) ?? null; n++; }
    }
    return ok({ updated: n });
  }
  if ((m = match(route, /^POST \/tasks\/([^/]+)\/merge-into\/([^/]+)$/))) {
    const drop = findTask(m[0]!);
    const keep = findTask(m[1]!);
    if (!drop || !keep) return notFound('Task');
    keep.notes = [keep.notes, `Merged: ${drop.title}${drop.notes ? `\n${drop.notes}` : ''}`].filter(Boolean).join('\n\n');
    keep.tags = [...new Set([...keep.tags, ...drop.tags])];
    drop.deleted_at = iso();
    return ok({ ...keep });
  }
  if ((m = match(route, /^(GET|PATCH|DELETE|POST) \/tasks\/([^/]+)(?:\/(done|reopen|skip|restore|focus))?$/))) {
    const [verb, ref, action] = m;
    const t = findTask(ref!);
    if (!t) return notFound('Task');
    if (verb === 'GET' && !action) return ok({ ...t, subtasks: tasks.filter((x) => x.parent_id === t.id) });
    if (verb === 'PATCH' && !action) { applyInput(t, b); return ok({ ...t }); }
    if (verb === 'DELETE' && !action) { t.deleted_at = iso(); return ok({ ...t }); }
    if (verb !== 'POST') return null;
    if (action === 'done') {
      if (t.recur && t.due_date) {
        const next = mkTask({ ...t, id: uid('t'), due_date: addDays(t.due_date, 7), status: 'open', done_at: null });
        tasks.push(next);
      }
      t.status = 'done';
      t.done_at = iso();
      t.pinned = false;
      return ok({ ...t });
    }
    if (action === 'reopen') { t.status = 'open'; t.done_at = null; return ok({ ...t }); }
    if (action === 'skip') {
      // Not today: a one-off moves to tomorrow, a recurring one to its next week. prev_due lets the client undo.
      const prev_due = t.due_date;
      t.due_date = t.recur && t.due_date ? addDays(t.due_date, 7) : addDays(today(), 1);
      return ok({ ...t, prev_due });
    }
    if (action === 'restore') { t.deleted_at = null; return ok({ ...t }); }
    if (action === 'focus') {
      const minutes = num(b.minutes, 25);
      focusLog.push({ task_id: t.id, minutes, day: today() });
      return created({ id: idOf(b, 'f'), task_id: t.id, minutes, started_at: str(b.started_at, iso()), day: today() });
    }
  }
  if (route === 'GET /projects') {
    return ok(projects.map((p): V2Project => ({ ...p, open_count: tasks.filter((t) => open(t) && t.project_id === p.id).length })));
  }
  if (route === 'POST /projects') {
    const p = projectOf(str(b.name));
    return p ? created({ ...p, open_count: 0 }) : bad('Name is required.');
  }
  if (route === 'GET /tasks-similar') return ok(similarTo(qp.get('title') ?? '', qp.get('except') ?? undefined));

  // habits
  if (route === 'GET /habits') return ok(listHabits(qp.get('day') ?? today()));
  if (route === 'POST /habits') {
    const name = str(b.name).trim();
    if (!name) return bad('Name is required.');
    const id = idOf(b, 'h');
    let h = habits.find((x) => x.id === id);
    if (!h) {
      h = { id, name, target_per_week: num(b.target_per_week, 7), archived: false };
      habits.push(h);
    }
    return created(habitView(h));
  }
  if ((m = match(route, /^PATCH \/habits\/([^/]+)$/))) {
    const h = habits.find((x) => x.id === m![0] || x.name.toLowerCase() === m![0]!.toLowerCase());
    if (!h) return notFound('Habit');
    if (b.name !== undefined) {
      const name = str(b.name).trim();
      if (!name) return bad('Name is required.');
      h.name = name;
    }
    if (b.target_per_week !== undefined) h.target_per_week = Math.min(7, Math.max(1, num(b.target_per_week, h.target_per_week)));
    if (b.archived !== undefined) h.archived = !!b.archived;
    return ok(habitView(h));
  }
  if ((m = match(route, /^POST \/habits\/([^/]+)\/(check|tiny-check|full-check)$/))) {
    const h = habits.find((x) => x.id === m![0] || x.name.toLowerCase() === m![0]!.toLowerCase());
    if (!h) return notFound('Habit');
    const day = str(b.day) || qp.get('day') || today();
    const map = habitChecks.get(day) ?? new Map<string, number>();
    // check sets the day's count (0 removes it), like the API; tiny/full checks add one.
    if (m[1] === 'check') map.set(h.id, Math.max(0, num(b.count, 1)));
    else map.set(h.id, (map.get(h.id) ?? 0) + 1);
    habitChecks.set(day, map);
    return ok(habitView(h, day));
  }

  // v1 goals
  if (route === 'GET /goals') return ok(goalsV1.filter((g) => (qp.get('status') ?? 'active') === 'all' || g.status === (qp.get('status') ?? 'active')));
  if ((m = match(route, /^POST \/goals\/([^/]+)\/value$/))) {
    const g = goalsV1.find((x) => x.id === m![0]);
    if (!g) return notFound('Goal');
    g.current = num(b.value, g.current ?? 0);
    g.current_day = str(b.day) || today();
    return ok({ ...g });
  }

  // asks
  if (route === 'GET /asks') return ok(openAsks(num(qp.get('n'), 1)));
  if ((m = match(route, /^POST \/asks\/([^/]+)\/(answer|skip)$/))) {
    const a = asks.find((x) => x.id === m![0] || x.key === m![0]);
    if (!a) return notFound('Question');
    a.status = m[1] === 'answer' ? 'answered' : 'skipped';
    return ok({ ok: true });
  }

  // questions
  if (route === 'GET /questions') {
    const s = qp.get('status');
    return ok(questions.filter((q) => !s || q.status === s).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  if (route === 'POST /questions') {
    const text = str(b.text).trim();
    if (!text) return bad('Question is empty.');
    const id = idOf(b, 'q');
    const dup = questions.find((q) => q.id === id || q.text.toLowerCase() === text.toLowerCase());
    if (dup) return ok({ ...dup, duplicate: true });
    const q: Question = { id, text, status: 'open', answer_md: null, answered_at: null, created_at: iso() };
    questions.push(q);
    return created(q);
  }
  if ((m = match(route, /^(PATCH|POST) \/questions\/([^/]+)(\/answer)?$/))) {
    const q = questions.find((x) => x.id === m![1]);
    if (!q) return notFound('Question');
    if (m[2]) {
      q.answer_md = str(b.answer_md);
      q.status = 'answered';
      q.answered_at = iso();
    } else {
      if (typeof b.text === 'string') q.text = b.text;
      if (b.status === 'open' || b.status === 'answered' || b.status === 'dropped') q.status = b.status;
    }
    return ok({ ...q });
  }

  // fits: what fits before the next anchor
  if (route === 'GET /fits') {
    const gap = 35;
    const fits: Fits = {
      gap_min: gap,
      anchor: { name: 'Dinner', key: 'dinner', at: at(today(), '19:30'), hhmm: '19:30', in_minutes: gap },
      tasks: listTasks('anytime').filter((t) => (t.est_minutes ?? 99) <= gap).slice(0, 5),
      reason: null,
    };
    return ok(fits);
  }

  // compost
  if (route === 'GET /compost') return ok({ items: composted.map((t) => ({ ...t })), preview: compostPreview() });
  if (route === 'POST /compost/run') {
    const run = compostPreview();
    for (const title of run.titles) {
      const t = tasks.find((x) => x.title === title && open(x));
      if (t) {
        t.someday = true;
        t.tags = [...t.tags, 'compost'];
        composted.push(t);
      }
    }
    return ok({ ...run, dry_run: false, note: `Moved tasks untouched for ${COMPOST_DAYS} days to Someday.` });
  }
  if ((m = match(route, /^POST \/compost\/([^/]+)\/restore$/))) {
    const i = composted.findIndex((t) => t.id === m![0]);
    if (i < 0) return notFound('Task');
    const t = composted.splice(i, 1)[0]!;
    t.someday = false;
    t.tags = t.tags.filter((x) => x !== 'compost');
    return ok({ ...t });
  }

  // triage
  if (route === 'GET /triage') {
    if (promotedDay !== today()) promotedToday = null;
    const items = listTasks('inbox');
    const tr: Triage = { items: items.slice(0, 5), inbox_total: items.length, promoted_today: promotedToday };
    return ok(tr);
  }
  if ((m = match(route, /^POST \/triage\/([^/]+)$/))) {
    const t = findTask(m[0]!);
    if (!t) return notFound('Task');
    const action = b.action as TriageAction;
    if (action === 'project') {
      if (promotedDay === today() && promotedToday && !b.urgent) {
        return fail409('One Inbox item already promoted today. Mark it urgent to add another.');
      }
      const p = projectOf(str(b.project, 'Studio'));
      t.project_id = p?.id ?? null;
      t.project_name = p?.name ?? null;
      promotedToday = { id: t.id, title: t.title };
      promotedDay = today();
    } else if (action === 'someday') t.someday = true;
    else if (action === 'trash') t.deleted_at = iso();
    return ok({ action, task: action === 'trash' ? null : { ...t } });
  }

  // park
  if (route === 'GET /park') return ok(parked.map((t) => ({ ...t })));
  if (route === 'POST /park') {
    const text = str(b.text).trim();
    if (!text) return bad('Nothing to park.');
    const t = mkTask({ title: text, someday: true, tags: ['parked'], source: 'park' });
    parked.unshift(t);
    return created({ id: t.id, title: t.title, message: 'Parked. It stays out of today.' });
  }

  // estimates
  if (route === 'GET /tasks-estimates') return ok(estimates());
  if (route === 'GET /tasks-estimates/hint') {
    const minutes = num(qp.get('minutes'));
    const tags = (qp.get('tags') ?? '').split(',').filter(Boolean);
    const e = estimates();
    const byTag = e.by_tag.find((x) => tags.includes(x.tag));
    const ratio = byTag?.ratio ?? e.overall.ratio ?? 1;
    const hint: EstimateHint = minutes > 0 && ratio > 1.05
      ? { minutes, suggest: Math.round((minutes * ratio) / 5) * 5, ratio, from: byTag ? `tag ${byTag.tag}` : 'all tasks' }
      : null;
    return ok(hint);
  }

  return null;
}

function fail409(message: string): Res {
  return { status: 409, body: { error: 'rule_violation', message } };
}

export const doneTasksBetween = (from: string, to: string) =>
  tasks.filter((t) => live(t) && t.status === 'done' && t.done_at && ymdOf(t.done_at) >= from && ymdOf(t.done_at) <= to);
const ymdOf = (isoStr: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(new Date(Date.parse(isoStr) - 4 * 3600000));
