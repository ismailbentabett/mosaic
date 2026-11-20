// avoid-ai-design-ignore: I2 -- mock calendar titles carry emoji by the calendar rules; data, not icons.
/**
 * In-browser fake backend for `npm run dev:mock` and the demo build. Only loaded through dynamic import
 * behind MOCK, so production builds never include it. The persona is Sam, a fictional freelance web designer.
 */
import type {
  CalEvent,
  Chat,
  ChatFile,
  ChatMessage,
  Check,
  Conflict,
  Mode,
  NoteFile,
  Project,
  RunHandlers,
  Task,
  Timer,
  ToolStep,
} from './api';
import { hm, ymd } from './time';
import { mockV2 } from './mock/index';

type Res = { status: number; body: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (body: unknown): Res => ({ status: 200, body });
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): Res => ({
  status,
  body: { error, message, ...extra },
});
const iso = (ms = Date.now()) => `${ymd(ms)}T${hm(ms)}:${String(new Date(ms).getUTCSeconds()).padStart(2, '0')}Z`;
const at = (date: string, t: string) => `${date}T${t}:00Z`;
const addDays = (date: string, n: number) => ymd(Date.parse(`${date}T12:00:00Z`) + n * 86400000);

// ---------- calendar ----------

type Spec = {
  title: string;
  start: string;
  end: string;
  kind: CalEvent['kind'];
  task?: string;
  ifThen?: string;
  minutes?: number;
  done?: string;
  must?: boolean;
  taskDone?: boolean;
};

const BLOCK_TASKS: Record<string, Pick<Spec, 'task' | 'ifThen' | 'minutes' | 'done' | 'must'>> = {
  '🚀 Kickoff': { task: 'Open the first priority, start a 50 min timer', ifThen: 'IF it is 08:00, THEN open the Tasks tab.', minutes: 10, done: 'DONE = timer running on the first priority.', must: false },
  '🧠 Deep work': { task: 'Design the portfolio case study layout', ifThen: 'IF it is 08:15, THEN open the case study file.', minutes: 90, done: 'DONE = layout for 3 sections drawn.', must: true },
  '🛠️ Project work': { task: 'Finish the recipe app home page', ifThen: 'IF it is 10:15, THEN open the home page draft.', minutes: 90, done: 'DONE = page works on the phone.', must: true },
  '📞 Meetings': { task: 'Reply to 3 emails, 1 call', ifThen: 'IF it is 14:00, THEN open the inbox.', minutes: 50, done: 'DONE = inbox zero + call notes saved.', must: true },
  '🗂️ Admin': { task: 'Pay the October utility bills', ifThen: 'IF it is 16:00, THEN open the bills folder.', minutes: 45, done: 'DONE = bills paid and logged.', must: false },
  '📚 Learning': { task: 'Course: one lesson, notes in Brain', ifThen: 'IF it is 20:30, THEN open lesson 12.', minutes: 40, done: 'DONE = lesson watched, 3 notes written.', must: false },
  '🧹 Buffer': { task: 'Tidy notes, plan tomorrow', ifThen: "IF it is 21:15, THEN open today's log.", minutes: 40, done: 'DONE = 3 priorities for tomorrow written.', must: false },
};

function dayEvents(date: string): CalEvent[] {
  const specs: Spec[] = [
    { title: 'Week: 9/12 deep-work blocks · 2 pages shipped', start: date, end: addDays(date, 1), kind: 'helper' },
    { title: 'Plan: 3 priorities = case study, home page, replies', start: date, end: addDays(date, 1), kind: 'helper' },
    { title: 'D12/30', start: date, end: addDays(date, 1), kind: 'banner' },
    { title: '😴 Sleep', start: '00:00', end: '06:00', kind: 'anchor' },
    { title: '🍽️ Breakfast', start: '07:30', end: '08:00', kind: 'anchor' },
    { title: '🚀 Kickoff', start: '08:00', end: '08:15', kind: 'block' },
    { title: '🧠 Deep work', start: '08:15', end: '09:45', kind: 'block', taskDone: true },
    { title: '🛠️ Project work', start: '10:15', end: '11:45', kind: 'block' },
    { title: '🍽️ Lunch', start: '13:00', end: '13:45', kind: 'anchor' },
    { title: '📞 Meetings', start: '14:00', end: '14:50', kind: 'block' },
    { title: '🗂️ Admin', start: '16:00', end: '16:45', kind: 'block' },
    { title: '🏋️ Gym', start: '18:00', end: '19:00', kind: 'anchor' },
    { title: '🍽️ Dinner', start: '19:30', end: '20:15', kind: 'anchor' },
    { title: '📚 Learning', start: '20:30', end: '21:10', kind: 'block' },
    { title: '🧹 Buffer', start: '21:15', end: '21:55', kind: 'block' },
    { title: '🌙 Wind-down', start: '22:45', end: '23:30', kind: 'anchor' },
    { title: '😴 Sleep', start: '23:30', end: '23:59', kind: 'anchor' },
  ];
  return specs.map((s, i) => {
    const allDay = s.kind === 'helper' || s.kind === 'banner';
    const emoji = /^(\p{Extended_Pictographic}️?)/u.exec(s.title)?.[1] ?? null;
    const t = s.kind === 'block' ? BLOCK_TASKS[s.title] : undefined;
    const task = t?.task ?? null;
    return {
      id: `ev_${date}_${i}`,
      title: task ? `${s.title} · ${task}` : s.title,
      baseTitle: s.title,
      task,
      kind: s.kind,
      blockName: s.kind === 'block' ? s.title : null,
      emoji,
      start: allDay ? s.start : at(date, s.start),
      end: allDay ? s.end : at(date, s.end),
      allDay,
      ifThen: t?.ifThen ?? null,
      minutes: t?.minutes ?? null,
      done: t?.done ?? null,
      must: t ? !!t.must : null,
      taskId: t ? `t_blk${i}` : null,
      taskDone: t ? !!s.taskDone : null,
    };
  });
}

const mustDone = new Map<string, boolean>();

// ---------- state ----------

let mode: Mode = 'Normal';
let timer: Timer | null = null;

// Ids are strings like the real API (project ids are short strings, task ids are UUIDs).
const projects: Project[] = [
  { id: 'p1', title: 'Inbox' },
  { id: 'p2', title: 'Studio' },
  { id: 'p3', title: 'Learning' },
  { id: 'p5', title: 'Admin' },
  { id: 'p6', title: 'Personal' },
];
const pid = (n: number) => `p${n}`;

const today = () => ymd();
let taskSeq = 100;
const mk = (title: string, project: number | string, due: string | null, extra: Partial<Task> = {}): Task => {
  const projectId = typeof project === 'number' ? pid(project) : project;
  return {
  id: `00000000-0000-4000-8000-${String(++taskSeq).padStart(12, '0')}`,
  title,
  description: '',
  done: false,
  doneAt: null,
  due,
  priority: 0,
  projectId,
  projectTitle: projects.find((p) => p.id === projectId)?.title ?? 'Inbox',
  ...extra,
  };
};

const tasks: Task[] = [
  mk('Finish the recipe app home page', 2, at(today(), '16:20'), { priority: 4, description: 'Recipe app. Layout from the sketch; prices in USD.' }),
  mk('Reply to Nour about the logo round', 2, at(today(), '17:20'), { priority: 3 }),
  mk('Write the case study intro', 2, at(today(), '12:20')),
  mk('Renew the portfolio domain', 5, at(addDays(today(), -1), '18:00')),
  mk('Book barber', 6, null),
  mk('Idea: a weekly meal-plan printout', 1, null),
  mk('Compare used hatchback prices', 1, null),
  mk('Watch a CSS grid talk', 1, null),
  mk('Course lesson 13', 3, at(addDays(today(), 1), '21:25')),
  mk('Send the gym log page draft', 2, at(addDays(today(), 2), '14:00'), { priority: 2 }),
  mk('File the quarterly tax form', 5, at(addDays(today(), 6), '18:00')),
  mk('Back up project files', 5, at(addDays(today(), 1), '22:20')),
  mk('Sent the case study for review', 2, null, { done: true, doneAt: iso(Date.now() - 86400000) }),
  mk('Shipped the recipe app search', 2, null, { done: true, doneAt: iso(Date.now() - 3 * 3600000) }),
];

const notes = new Map<string, NoteFile>();
const put = (path: string, content: string, ago = 0) =>
  notes.set(path, { path, content, mtime: iso(Date.now() - ago) });

put(
  `Log/${today()}.md`,
  `# ${today()}\n\n- 08:05 Kickoff on time\n- 11:40 Recipe app home page works on the phone\n- 14:55 Idea: a **weekly meal-plan** printout\n`,
  20 * 60000,
);
put(
  'Projects/Templates.md',
  `---\ntags: [projects]\n---\n# Note templates\n\n## Project kickoff\n\nGoal: {goal}. First step: {step}. Done means: {done}.\n\n## Weekly check (Sunday)\n\n- Keep it to one line per project\n- Link the plan again\n- [ ] Try a version with a question\n- [x] Move the budget to the plan\n\nSee [[Budget]] and [[SOP]].\n`,
  2 * 3600000,
);
put(
  'Projects/Budget.md',
  `# Budget\n\n1. Setup: *one-time* tools\n2. Monthly: hosting + domains\n\nOpen the \`plan\` doc before spending.\n`,
  26 * 3600000,
);
put('SOP.md', `# SOP\n\n## New project\n\n1. Copy the starter project\n2. Connect the domain\n3. Write the [first note](https://example.com/form)\n`, 50 * 3600000);
put('Learning/Notes.md', `# Notes\n\n- *idempotent*: same result when run twice\n- *debounce*: wait for a pause before acting\n- *backoff*: wait longer after each retry\n`, 4 * 86400000);
put('Money.md', `# Money\n\nTotals only.\n\n| Month | In | Out |\n|---|---|---|\n| Oct | 710 | 315 |\n`, 6 * 86400000);

const conflicts: Conflict[] = [
  {
    conflict: 'Projects/Budget.sync-conflict-20261110-221502-PHONE.md',
    original: 'Projects/Budget.md',
    originalContent: '',
    conflictContent: `# Budget\n\n1. Setup: one-time tools\n2. Monthly: hosting + domains + 1 course\n`,
  },
];

const status = (): { overall: 'ok' | 'warn' | 'error'; checks: Check[]; updatedAt: string } => {
  const since = iso(Date.now() - 3 * 86400000);
  const checks: Check[] = [
    { id: 'google', label: 'Google', ok: true, level: 'ok', message: 'Calendar and Sheet reachable.', fix: null, since },
    { id: 'vault', label: 'Vault sync', ok: true, level: 'ok', message: 'Notes synced 2 min ago.', fix: null, since },
    { id: 'push', label: 'Push', ok: true, level: 'ok', message: 'Push service reachable.', fix: null, since },
    { id: 'claude', label: 'Assistant', ok: true, level: 'ok', message: 'Logged in. No run active.', fix: null, since },
    { id: 'backup', label: 'Backup', ok: true, level: 'ok', message: 'Last backup 03:00 today.', fix: null, since },
  ];
  return { overall: 'ok', checks, updatedAt: iso() };
};

// ---------- Claude ----------

type Run = {
  id: string;
  chatId: string;
  events: ({ type: 'text'; text: string } | { type: 'tool'; step: ToolStep } | { type: 'done'; error: string | null })[];
  finished: boolean;
  subs: Set<RunHandlers>;
  timers: ReturnType<typeof setTimeout>[];
};

const chats = new Map<string, Chat & { updatedAt: string }>();
const runs = new Map<string, Run>();
let activeRun: Run | null = null;
let runSeq = 0;

chats.set('chat_1', {
  id: 'chat_1',
  title: '/plan-tomorrow',
  updatedAt: iso(Date.now() - 20 * 3600000),
  messages: [
    { role: 'user', text: '/plan-tomorrow', tools: [], ts: iso(Date.now() - 20 * 3600000) },
    {
      role: 'assistant',
      text: 'Tomorrow is planned.\n\n- **Project work** · Finish the recipe app home page\n- **Deep work** · Design the portfolio case study layout\n- **Meetings** · Reply to 3 emails, 1 call\n\nNext action: sleep at 23:30.',
      tools: [
        { name: 'get_calendar', summary: 'Read tomorrow’s calendar' },
        { name: 'set_block_task', summary: 'Updated 🛠️ Project work' },
        { name: 'set_block_task', summary: 'Updated 🧠 Deep work' },
        { name: 'set_block_task', summary: 'Updated 📞 Meetings' },
      ],
      ts: iso(Date.now() - 20 * 3600000),
    },
  ],
});

function replyFor(prompt: string): { tools: ToolStep[]; text: string } {
  const cmd = prompt.split(/\s/)[0];
  if (cmd === '/what-now') {
    return {
      tools: [
        { name: 'get_today', summary: 'Read today’s calendar' },
        { name: 'get_tasks', summary: 'Read Today tasks' },
      ],
      text: `Now: **🧠 Deep work** until 16:20.\n\nTask: Design the portfolio case study layout.\n\n1. Open the \`case-study\` file\n2. Sketch the three sections\n3. Reuse the outline from [[Templates]]\n\nNext action: start the 50 min timer and draw section 1.`,
    };
  }
  if (cmd === '/money-check') {
    return {
      tools: [{ name: 'read_sheet', summary: 'Read Rules+Money totals' }],
      text: 'Cash about **$1,400**. Savings fund on track if spending stays under budget this quarter.\n\nNext action: log this month’s totals.',
    };
  }
  return {
    tools: [
      { name: 'get_today', summary: 'Read today’s calendar' },
      { name: 'read_sheet', summary: 'Read Tasks tab' },
      { name: 'set_block_task', summary: 'Updated 🧹 Buffer' },
    ],
    text: `Done: \`${cmd}\`.\n\n- Mode stays **Normal**\n- Buffer · Tidy notes, plan tomorrow\n\nNext action: open the Today tab.`,
  };
}

function emit(run: Run, ev: Run['events'][number]) {
  run.events.push(ev);
  for (const h of run.subs) deliver(h, run, ev);
}

function deliver(h: RunHandlers, run: Run, ev: Run['events'][number]) {
  if (ev.type === 'text') h.text(ev.text);
  else if (ev.type === 'tool') h.tool(ev.step);
  else h.done({ chatId: run.chatId, error: ev.error, limitResetAt: null });
}

function finish(run: Run, text: string, tools: ToolStep[], error: string | null) {
  if (run.finished) return;
  run.finished = true;
  run.timers.forEach(clearTimeout);
  const chat = chats.get(run.chatId)!;
  chat.messages.push({ role: 'assistant', text, tools, ts: iso(), error: error ?? undefined });
  chat.updatedAt = iso();
  if (activeRun === run) activeRun = null;
  emit(run, { type: 'done', error });
}

const mockFiles = new Map<string, { file: ChatFile; blob: Blob }>();
let fileSeq = 0;

export async function mockUpload(blob: Blob, name: string): Promise<ChatFile> {
  await sleep(300 + Math.random() * 400);
  if (blob.size > 7 * 1024 * 1024) throw Object.assign(new Error('File too large (max 7 MB).'), { code: 'bad_request' });
  const ext = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toLowerCase() || 'bin';
  const file: ChatFile = { id: `00000000-0000-4000-8000-${String(++fileSeq).padStart(12, '0')}.${ext}`, name, type: blob.type || 'application/octet-stream', size: blob.size };
  mockFiles.set(file.id, { file, blob });
  return file;
}

export const mockFileBlob = (id: string): Blob | null => mockFiles.get(id)?.blob ?? null;

function startRun(prompt: string, chatId?: string, files: ChatFile[] = []): { runId: string; chatId: string } {
  let chat = chatId ? chats.get(chatId) : undefined;
  if (!chat) {
    const id = `chat_${Date.now()}`;
    chat = { id, title: (files.length && /^Look at th/.test(prompt) ? files[0]!.name : prompt).slice(0, 60), messages: [], updatedAt: iso() };
    chats.set(id, chat);
  }
  const user: ChatMessage = { role: 'user', text: prompt, tools: [], ts: iso(), ...(files.length ? { files } : {}) };
  chat.messages.push(user);
  const run: Run = { id: `run_${++runSeq}`, chatId: chat.id, events: [], finished: false, subs: new Set(), timers: [] };
  runs.set(run.id, run);
  activeRun = run;
  const { tools, text } = replyFor(prompt);
  let t = 400;
  for (const step of tools) {
    run.timers.push(setTimeout(() => emit(run, { type: 'tool', step }), t));
    t += 500;
  }
  const chunks = text.match(/[\s\S]{1,14}/g) ?? [];
  for (const c of chunks) {
    run.timers.push(setTimeout(() => emit(run, { type: 'text', text: c }), t));
    t += 60;
  }
  run.timers.push(setTimeout(() => finish(run, text, tools, null), t + 100));
  return { runId: run.id, chatId: chat.id };
}

export function mockSubscribe(runId: string, h: RunHandlers): () => void {
  const run = runs.get(runId);
  h.reset();
  if (!run) {
    setTimeout(() => h.done({ chatId: '', error: 'This run is no longer available.', limitResetAt: null }), 50);
    return () => {};
  }
  for (const ev of run.events) deliver(h, run, ev);
  if (!run.finished) run.subs.add(h);
  return () => run.subs.delete(h);
}

// ---------- router ----------

/** Dev helper: change a note "on the server" to test the 409 flow. */
(window as unknown as { __mockTouch: (p: string) => void }).__mockTouch = (p: string) => {
  const f = notes.get(p);
  if (f) put(p, f.content + '\n- edited on the phone\n');
};

export async function mockFetch(method: string, rawPath: string, body: unknown): Promise<Res> {
  await sleep(150 + Math.random() * 200);
  const url = new URL(rawPath, location.origin);
  const p = url.pathname;
  const qp = url.searchParams;
  const b = (body ?? {}) as Record<string, unknown>;
  const route = `${method} ${p}`;
  let m: RegExpExecArray | null;

  if (route === 'GET /api/me') return ok({ login: 'sam@example.com', name: 'Sam' });
  if (route === 'GET /api/status') return ok(status());

  if (route === 'GET /api/today') {
    const date = qp.get('date') ?? today();
    const events = dayEvents(date).map((e) => (mustDone.has(e.id) ? { ...e, taskDone: mustDone.get(e.id)! } : e));
    const now = Date.now();
    const timed = events.filter((e) => !e.allDay);
    const nowEv = timed.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end) && e.kind === 'block') ??
      timed.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end)) ?? null;
    const next = timed.filter((e) => Date.parse(e.start) > now)[0] ?? null;
    if (timer && Date.parse(timer.endsAt) < now - 3600000) timer = null;
    return ok({
      date,
      weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
      mode,
      connected: { google: true },
      now: nowEv,
      next,
      events,
      musts: events.filter((e) => e.must === true),
      timer,
      warnings: [],
    });
  }
  if ((m = /^POST \/api\/today\/must\/([^/]+)\/done$/.exec(route))) {
    mustDone.set(decodeURIComponent(m[1]!), !!b.done);
    return ok({ ok: true, taskId: 't_blk' });
  }

  if (route === 'GET /api/tasks') {
    const view = qp.get('view') ?? 'all';
    const project = qp.get('project') || null;
    const t0 = today();
    const limit = addDays(t0, 14);
    const weekAgo = Date.now() - 7 * 86400000;
    let list = tasks.filter((t) => {
      if (view === 'done') return t.done && !!t.doneAt && Date.parse(t.doneAt) > weekAgo;
      if (t.done) return false;
      if (view === 'today') return !!t.due && ymd(t.due) <= t0;
      if (view === 'inbox') return t.projectId === 'p1';
      if (view === 'upcoming') return !!t.due && ymd(t.due) > t0 && ymd(t.due) <= limit;
      return true;
    });
    if (project) list = list.filter((t) => t.projectId === project);
    list = [...list].sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || b.priority - a.priority);
    return ok({ projects, tasks: list });
  }
  if (route === 'POST /api/tasks') {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 250) return fail(400, 'bad_request', 'title is required (max 250)');
    const projectId = b.projectId == null || b.projectId === '' ? 'p1' : b.projectId;
    if (typeof projectId !== 'string') return fail(400, 'bad_request', 'projectId must be a project id');
    if (!projects.some((p) => p.id === projectId)) return fail(404, 'not_found', `project ${projectId} not found`);
    if (b.due != null && b.due !== '' && (typeof b.due !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(b.due))) return fail(400, 'bad_request', 'due must be YYYY-MM-DD or null');
    const prio = b.priority === undefined ? 0 : Number(b.priority);
    if (!Number.isFinite(prio) || prio < 0) return fail(400, 'bad_request', 'priority must be a number from 0');
    const t = mk(title, projectId, (b.due as string) || null, {
      description: typeof b.description === 'string' ? b.description : '',
      priority: Math.min(5, prio),
    });
    tasks.push(t);
    return ok(t);
  }
  if ((m = /^PATCH \/api\/tasks\/([^/]+)$/.exec(route))) {
    const id = decodeURIComponent(m[1]!);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return fail(400, 'bad_request', 'id must be a task id');
    const t = tasks.find((x) => x.id === id);
    if (!t) return fail(404, 'not_found', 'That task no longer exists. Refresh the list.');
    if (b.title !== undefined && (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 250)) return fail(400, 'bad_request', 'title must be 1–250 characters');
    if (b.done !== undefined && typeof b.done !== 'boolean') return fail(400, 'bad_request', 'done must be true or false');
    if (b.priority !== undefined && (typeof b.priority !== 'number' || !Number.isFinite(b.priority) || b.priority < 0)) return fail(400, 'bad_request', 'priority must be a number from 0');
    if (b.projectId !== undefined && b.projectId !== null && !projects.some((p) => p.id === b.projectId)) return fail(404, 'not_found', `project ${String(b.projectId)} not found`);
    if (typeof b.title === 'string') t.title = b.title.trim();
    if (typeof b.description === 'string') t.description = b.description;
    if ('due' in b) t.due = (b.due as string | null) ?? null;
    if (typeof b.priority === 'number') t.priority = b.priority;
    if (typeof b.projectId === 'string') {
      t.projectId = b.projectId;
      t.projectTitle = projects.find((x) => x.id === b.projectId)?.title ?? 'Inbox';
    }
    if (typeof b.done === 'boolean') {
      t.done = b.done;
      t.doneAt = b.done ? iso() : null;
    }
    return ok({ ...t });
  }

  if (route === 'POST /api/capture') {
    const text = String(b.text ?? '').trim();
    if (!text) return fail(400, 'bad_request', 'Capture text is empty.');
    if (b.kind === 'task') {
      const t = mk(text, 1, null);
      tasks.push(t);
      return ok({ ok: true, kind: 'task', taskId: t.id, duplicate: false });
    }
    const path = `Log/${today()}.md`;
    const f = notes.get(path);
    put(path, `${f?.content ?? `# ${today()}\n\n`}- ${hm(Date.now())} ${text}\n`);
    return ok({ ok: true, kind: 'note', path, duplicate: false });
  }

  if (route === 'GET /api/notes/recent') {
    const all = [...notes.values()].sort((a, b) => b.mtime.localeCompare(a.mtime));
    return ok({
      notes: all.slice(0, 12).map((n) => ({ path: n.path, title: n.path.split('/').pop()!.replace(/\.md$/, ''), mtime: n.mtime, size: n.content.length })),
      pinned: [
        { path: 'Projects/Templates.md', title: 'Templates' },
        { path: 'SOP.md', title: 'SOP' },
      ],
      today: { path: `Log/${today()}.md`, exists: notes.has(`Log/${today()}.md`) },
    });
  }
  if (route === 'GET /api/notes/search') {
    const q = (qp.get('q') ?? '').toLowerCase();
    const results: { path: string; title: string; line: number; snippet: string }[] = [];
    for (const n of notes.values()) {
      const lines = n.content.split('\n');
      const title = n.path.split('/').pop()!.replace(/\.md$/, '');
      const hit = lines.findIndex((l) => l.toLowerCase().includes(q));
      if (hit >= 0) results.push({ path: n.path, title, line: hit + 1, snippet: lines[hit]!.trim().slice(0, 140) });
      else if (n.path.toLowerCase().includes(q)) results.push({ path: n.path, title, line: 1, snippet: lines[0] ?? '' });
    }
    return ok({ results: results.slice(0, 50) });
  }
  if (route === 'GET /api/notes/file') {
    const f = notes.get(qp.get('path') ?? '');
    return f ? ok({ ...f }) : fail(404, 'not_found', 'No note at that path.');
  }
  if (route === 'PUT /api/notes/file') {
    const path = String(b.path);
    const cur = notes.get(path);
    if (cur && cur.mtime !== b.baseMtime) return fail(409, 'conflict', 'This note changed since you opened it.', { mtime: cur.mtime, content: cur.content });
    put(path, String(b.content ?? ''));
    return ok({ mtime: notes.get(path)!.mtime });
  }
  if (route === 'POST /api/notes/append') {
    const path = String(b.path);
    const cur = notes.get(path)?.content ?? '';
    const head = `## ${today()}`;
    const add = cur.includes(head) ? `${b.text}\n` : `\n${head}\n\n${b.text}\n`;
    put(path, cur.replace(/\n*$/, '\n') + add);
    return ok({ mtime: notes.get(path)!.mtime });
  }
  if (route === 'GET /api/notes/conflicts') {
    return ok({
      conflicts: conflicts.map((c) => ({ ...c, originalContent: notes.get(c.original)?.content ?? '' })),
    });
  }
  if (route === 'POST /api/notes/conflicts/resolve') {
    const i = conflicts.findIndex((c) => c.conflict === b.conflict);
    if (i < 0) return fail(404, 'not_found', 'That conflict was already resolved.');
    const c = conflicts[i]!;
    if (b.action === 'keep_conflict') put(c.original, c.conflictContent);
    if (b.action === 'merge') put(c.original, String(b.content ?? ''));
    conflicts.splice(i, 1);
    return ok({ ok: true });
  }

  if (route === 'GET /api/mode') return ok({ mode, source: 'sheet' });
  if (route === 'PUT /api/mode') {
    mode = b.mode as Mode;
    return ok({ mode });
  }

  if (route === 'GET /api/timer') return ok(timer);
  if (route === 'POST /api/timer') {
    const min = Number(b.minutes ?? 50);
    timer = { label: String(b.label ?? 'Focus'), startedAt: iso(), endsAt: iso(Date.now() + min * 60000) };
    return ok(timer);
  }
  if (route === 'DELETE /api/timer') {
    timer = null;
    return ok({ ok: true });
  }
  if (route === 'POST /api/timer/pause') {
    if (!timer) return fail(404, 'not_found', 'No timer is running.');
    if (!timer.pausedAt) timer = { ...timer, pausedAt: iso(), pauseReason: String(b.reason ?? 'other'), pausedMs: timer.pausedMs ?? 0 };
    return ok(timer);
  }
  if (route === 'POST /api/timer/resume') {
    if (!timer) return fail(404, 'not_found', 'No timer is running.');
    if (timer.pausedAt) {
      const gap = Math.max(0, Date.now() - Date.parse(timer.pausedAt));
      timer = { ...timer, endsAt: iso(Date.parse(timer.endsAt) + gap), pausedAt: null, pausedMs: (timer.pausedMs ?? 0) + gap };
    }
    return ok(timer);
  }

  if (route === 'GET /api/claude/busy') return ok({ busy: !!activeRun, label: activeRun ? 'chat' : null });
  if (route === 'GET /api/claude/chats') {
    return ok({
      chats: [...chats.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    });
  }
  if ((m = /^GET \/api\/claude\/chats\/([^/]+)$/.exec(route))) {
    const c = chats.get(decodeURIComponent(m[1]!));
    return c ? ok({ id: c.id, title: c.title, messages: c.messages.map((x) => ({ ...x })) }) : fail(404, 'not_found', 'Chat not found.');
  }
  if (route === 'POST /api/claude/run') {
    if (activeRun) return fail(409, 'conflict', 'The assistant is busy (chat)', { busy: 'chat' });
    const ids = Array.isArray(b.files) ? (b.files as unknown[]).map(String) : [];
    const files = ids.map((id) => mockFiles.get(id)?.file).filter((f): f is ChatFile => !!f);
    if (files.length !== ids.length) return fail(400, 'bad_request', 'A file is missing. Attach it again.');
    const prompt = String(b.prompt ?? '').trim() || (files.length ? (files.length === 1 ? 'Look at this file.' : 'Look at these files.') : '');
    if (!prompt) return fail(400, 'bad_request', 'Prompt is empty.');
    return ok(startRun(prompt, b.chatId as string | undefined, files));
  }
  if ((m = /^POST \/api\/claude\/runs\/([^/]+)\/stop$/.exec(route))) {
    const run = runs.get(decodeURIComponent(m[1]!));
    if (run && !run.finished) {
      const text = run.events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
      const tools = run.events.filter((e) => e.type === 'tool').map((e) => (e as { step: ToolStep }).step);
      finish(run, text, tools, 'Stopped.');
    }
    return ok({ ok: true });
  }

  if (p.startsWith('/api/v2/')) {
    const r = mockV2(method, p.slice(7), qp, b, mode);
    if (r) return r;
  }

  return fail(404, 'not_found', `Mock has no route for ${route}.`);
}
