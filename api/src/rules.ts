// Calendar planning rules: which events are writable, the "Title · task" rule, the 3-line
// description, daily limits and modes. Pure parts are exported for tests; writes go through calendar.ts.
import { getDb } from './db.ts';
import { AppError } from './errors.ts';
import { addDays, dateOf, dowOf, hhmm } from './time.ts';
import { getEventRaw, listEvents, patchEvent, upsertAllDayHelper } from './calendar.ts';
import type { CalEvent } from './calendar.ts';
import { getMode } from './sheet.ts';
import type { Mode } from './sheet.ts';
import { modeForDay } from './modeState.ts';
import * as appTasks from './modules/tasks/store.ts';

export type Kind = CalEvent['kind'];
export type BlockInput = {
  event_id: string; task: string; first_action: string; minutes: number; done: string; must: boolean; project?: string;
};

const SEP = '·';
const FE0F = /️/g;
const norm = (s: string) => s.replace(FE0F, '');

/** Writable blocks, canonical names. '🗓️ Review' is an alias of 'Weekly review'. */
export const BLOCKS = [
  '🗓️ Weekly review', '🗂️ Admin', '🛠️ Project work', '📚 Learning',
  '🧠 Deep work', '📞 Meetings', '🧹 Buffer', '🚀 Kickoff',
] as const;
const ALIASES: [string, string][] = [
  ...BLOCKS.map((b) => [b, b] as [string, string]),
  ['🗓️ Review', '🗓️ Weekly review'],
];
export const PRIORITY_BLOCKS = ['🧠 Deep work', '📞 Meetings', '🛠️ Project work'];
export const LAUNCH = '🚀 Kickoff';
const ANCHORS = ['😴', '🏋', '🧴', '🍽', '🌙', '👪'];
const ALNUM = /[\p{L}\p{N}]/u;

/** "X · task" → { baseTitle: "X", task: "task" }. Undo = baseTitle. */
export const parseTitle = (summary: string): { baseTitle: string; task: string | null } => {
  const i = summary.indexOf(SEP);
  if (i < 0) return { baseTitle: summary.trim(), task: null };
  const task = summary.slice(i + 1).trim();
  return { baseTitle: summary.slice(0, i).trim(), task: task || null };
};

/** Drops leading emoji (any colour circle or icon) so blocks match by name: "🔵 Deep work: …" → "Deep work: …". */
const LEAD_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Emoji_Component}‍️]|\s)+/u;
const nameOnly = (s: string) => norm(s).trimStart().replace(LEAD_EMOJI, '');

/** Canonical block name for a base title, or null. Matches the name after any leading emoji; next char must not be alphanumeric. */
export const blockOf = (baseTitle: string): string | null => {
  if (!leadingEmoji(baseTitle)) return null; // blocks always start with an emoji; "Kickoff call" is not a block
  const t = nameOnly(baseTitle);
  for (const [alias, canon] of ALIASES) {
    const a = nameOnly(alias);
    if (t.startsWith(a) && !ALNUM.test(t.charAt(a.length))) return canon;
  }
  return null;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const leadingEmoji = (s: string): string | null => {
  const first = segmenter.segment(s.trimStart())[Symbol.iterator]().next().value?.segment;
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : null;
};

export const classify = (summary: string, allDay: boolean): { kind: Kind; blockName: string | null; emoji: string | null } => {
  const emoji = leadingEmoji(summary);
  const n = norm(summary).trimStart();
  if (n.startsWith('Week:') || n.startsWith('Plan:')) return { kind: 'helper', blockName: null, emoji };
  if (allDay && /\bD\d+\/30\b/.test(n)) return { kind: 'banner', blockName: null, emoji };
  const blockName = blockOf(parseTitle(summary).baseTitle);
  if (blockName) return { kind: 'block', blockName, emoji };
  if (ANCHORS.some((a) => n.startsWith(a))) return { kind: 'anchor', blockName: null, emoji };
  return { kind: 'other', blockName: null, emoji };
};

// ---------- description ----------
// Line 1: "IF it is 15:30, THEN …". The older "IF it is after X (15:30), THEN …" form still parses.
const RE_L1 = /^IF it is (?:after [^()]+ \()?(\d{1,2}:\d{2})\)?, THEN (.*)$/;
const RE_L2 = /^(\d+)m\. DONE = (.*)$/;
const RE_L3 = /^(PRIORITY|OPTIONAL)$/;
const stripDot = (s: string) => s.trim().replace(/\.+$/, '').trim();

const toLines = (desc: string) =>
  desc.replace(/<br\s*\/?>/gi, '\n').replace(/\r\n?/g, '\n').split('\n');

/** Splits a description into the generated 3 lines (if any, at the top) and the original rest. */
export const splitDescription = (desc: string): { generated: string[]; rest: string } => {
  const lines = toLines(desc ?? '');
  const generated: string[] = [];
  const res = [RE_L1, RE_L2, RE_L3];
  while (generated.length < 3 && lines.length && res[generated.length].test(lines[0].trim())) generated.push(lines.shift()!.trim());
  if (generated.length && lines.length && lines[0].trim() === '') lines.shift();
  return { generated, rest: lines.join('\n').trim() };
};

export const parseDescription = (desc: string) => {
  const { generated: g } = splitDescription(desc);
  const m1 = g[0]?.match(RE_L1);
  const m2 = g[1]?.match(RE_L2);
  const m3 = g[2]?.match(RE_L3);
  return {
    ifThen: g[0] ?? null,
    firstAction: m1 ? stripDot(m1[2]) : null,
    minutes: m2 ? Number(m2[1]) : null,
    done: m2 ? stripDot(m2[2]) : null,
    must: m3 ? m3[1] === 'PRIORITY' : null,
  };
};

/** Line 1: "IF it is 15:30, THEN …". */
export const ifThenLine = (startHHMM: string, firstAction: string) => `IF it is ${startHHMM}, THEN ${stripDot(firstAction)}.`;

export const generatedLines = (startHHMM: string, a: Pick<BlockInput, 'first_action' | 'minutes' | 'done' | 'must'>) => [
  ifThenLine(startHHMM, a.first_action),
  `${a.minutes}m. DONE = ${stripDot(a.done)}.`,
  a.must ? 'PRIORITY' : 'OPTIONAL',
];

/** New description: generated 3 lines, then any original text after one blank line. Idempotent. */
export const buildDescription = (oldDesc: string, startHHMM: string, a: Pick<BlockInput, 'first_action' | 'minutes' | 'done' | 'must'>) => {
  const { rest } = splitDescription(oldDesc);
  const lines = generatedLines(startHHMM, a).join('\n');
  return rest ? `${lines}\n\n${rest}` : lines;
};

export const buildSummary = (summary: string, task: string) => `${parseTitle(summary).baseTitle} ${SEP} ${task.trim()}`;
export const stripSummary = (summary: string) => parseTitle(summary).baseTitle;

// ---------- validation ----------
const violation = (msg: string): never => { throw new AppError('rule_violation', msg); };
const oneLine = (s: unknown) => typeof s === 'string' && s.trim() !== '' && !/[\r\n]/.test(s);
export const eventDate = (e: Pick<CalEvent, 'start'>) => (/^\d{4}-\d{2}-\d{2}$/.test(e.start) ? e.start : dateOf(new Date(e.start)));

/** Throws rule_violation if writing `a` to `ev` breaks a planning rule. `dayEvents` = all events that day. */
export const validate = (ev: CalEvent, dayEvents: CalEvent[], a: BlockInput, mode: Mode): void => {
  if (ev.kind !== 'block' || !ev.blockName)
    violation(`Only work blocks can get a task; "${ev.baseTitle}" is a ${ev.kind} event and is never edited.`);
  const block = ev.blockName as string;
  if (dowOf(eventDate(ev)) === 6) violation('Saturday is rest day: no titles are written.');
  if (!oneLine(a.task)) violation('Task is required and must be one line.');
  const task = a.task.trim();
  if (task.includes(SEP)) violation('Task may not contain "·".');
  if ([...task].length > 44) violation(`Task must be under 45 characters (got ${[...task].length}).`);
  if (!oneLine(a.first_action)) violation('first_action is required (one line, under 2 minutes).');
  if (!Number.isInteger(a.minutes) || a.minutes < 5 || a.minutes > 240) violation('minutes must be a whole number from 5 to 240.');
  if (!oneLine(a.done)) violation('done (definition of done) is required, one line.');
  const must = a.must === true;
  if (must && !PRIORITY_BLOCKS.includes(block)) violation(`Priority is only for Deep work, Meetings and Project work, not ${block}.`);

  const others = dayEvents.filter((e) => e.id !== ev.id && e.kind === 'block');
  if (must && others.filter((e) => e.must === true).length >= 3) violation('Max 3 priority blocks per day: this would be the 4th.');
  // Zero and Family allow one titled block in total, and Kickoff counts toward it.
  const titledAny = others.filter((e) => e.task).length;
  if (mode === 'Zero') {
    if (titledAny >= 1) violation('Zero mode: only one task today.');
    if (a.minutes > 10) violation('Zero mode: the one task is 10 minutes max.');
  }
  if (mode === 'Family' && titledAny >= 1) violation('Family mode: 1 block max.');
  if (block === LAUNCH) return; // Normal days: Kickoff is a ritual, never counted toward the 6
  const titled = others.filter((e) => e.task && e.blockName !== LAUNCH).length;
  if (titled + 1 > 6) violation('Max 6 titled work blocks a day: this would be the 7th.');
};

/** App project for a block task's mirrored app task (null = do not mirror). */
export const projectFor = (block: string, task: string, explicit?: string): string | null => {
  if (explicit?.trim()) return explicit.trim();
  if (block === LAUNCH) return null;
  if (/admin|money|invoice|tax|bank/i.test(task)) return 'Admin';
  if (block === '🗂️ Admin') return 'Admin';
  if (block === '📚 Learning') return 'Learning';
  if (block.startsWith('🗓️')) return 'Personal';
  if (/course|lesson|study/i.test(task)) return 'Learning';
  return 'Work';
};

// ---------- effects ----------
const log = async (source: string, tool: string, summary: string) => {
  try { (await import('./log.ts')).logAction(source, tool, summary); } catch { /* never throws */ }
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The app task mirrored from a block (tasks.event_id), if any. */
export const mirrorOf = (eventId: string) => {
  const r = getDb().prepare('SELECT id FROM tasks WHERE event_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1').get(eventId) as { id: string } | undefined;
  return r ? (appTasks.getTask(r.id) ?? null) : null;
};
/** Drops the legacy event_task link row (pre-app.db mirror). */
const dropLegacyLink = (eventId: string) => {
  try { getDb().prepare('DELETE FROM event_task WHERE event_id = ?').run(eventId); } catch { /* table may be gone */ }
};

/** Mode for a date: a Rescue Zero covers only its own life-day, so tomorrow is planned in the mode after it. */
const modeNow = async (date: string): Promise<Mode> => {
  try { return modeForDay(date, (await getMode()).mode); } catch { return 'Normal'; }
};

export const listBlocks = async (date: string): Promise<CalEvent[]> =>
  (await listEvents(date)).filter((e) => e.kind === 'block');

let chain: Promise<unknown> = Promise.resolve();
/** Calendar writes run one at a time so priority / max-6 checks can't race. */
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
};

const setBlockTaskRaw = async (a: BlockInput, source: string) => {
  const { event: ev, description: raw } = await getEventRaw(a.event_id);
  const date = eventDate(ev);
  const [day, mode] = await Promise.all([listEvents(date), modeNow(date)]);
  validate(ev, day, a, mode);

  const task = a.task.trim();
  const must = a.must === true;
  const summary = buildSummary(ev.title, task);
  const startHHMM = ev.allDay ? '00:00' : hhmm(new Date(ev.start));
  const gen = { first_action: a.first_action, minutes: a.minutes, done: a.done, must };
  const description = buildDescription(raw, startHHMM, gen);
  await patchEvent(ev.id, { summary, description });

  // Mirror into the app task list (tasks.event_id). One app task per block; rewriting the block updates it.
  const warnings: string[] = [];
  let taskId: string | null = null;
  let taskDone: boolean | null = null;
  const project = projectFor(ev.blockName as string, task, a.project);
  if (project) {
    try {
      const fields = {
        title: task, project, due_date: date, due_time: ev.allDay ? null : startHHMM, est_minutes: a.minutes,
        first_action: stripDot(a.first_action), done_def: stripDot(a.done), priority: must ? 3 : 1,
      };
      const cur = mirrorOf(ev.id);
      const t = cur ? appTasks.updateTask(cur.id, fields) : appTasks.addTask({ ...fields, source: 'block', event_id: ev.id });
      taskId = t.id;
      taskDone = t.status === 'done';
    } catch (e) {
      warnings.push(`App task mirror failed: ${errMsg(e)}`);
    }
  }

  const p = parseDescription(description);
  const event: CalEvent = {
    ...ev, title: summary, task, ifThen: p.ifThen, minutes: p.minutes, done: p.done, must,
    taskId: taskId ?? ev.taskId, taskDone: taskId != null ? taskDone : ev.taskDone,
  };
  const diff = `${ev.blockName}: "${ev.title}" → "${summary}"`;
  await log(source, 'set_block_task', diff);
  return { event, taskId, warnings, diff };
};

const clearBlockTaskRaw = async (a: { event_id?: string; date?: string }, source: string): Promise<{ cleared: string[] }> => {
  let targets: CalEvent[];
  if (a.event_id) {
    const ev = (await getEventRaw(a.event_id)).event;
    if (ev.kind !== 'block') violation(`"${ev.baseTitle}" is a ${ev.kind} event and is never edited.`);
    targets = [ev];
  } else if (a.date) {
    targets = (await listBlocks(a.date)).filter((e) => e.task || e.ifThen);
  } else {
    throw new AppError('bad_request', 'Give event_id or date.');
  }
  const cleared: string[] = [];
  for (const ev of targets) {
    const { rest } = splitDescription((await getEventRaw(ev.id)).description);
    await patchEvent(ev.id, { summary: ev.baseTitle, description: rest });
    // The mirrored app task goes to Trash (restorable) unless done; a done one stays as the record.
    const t = mirrorOf(ev.id);
    if (t && t.status !== 'done') appTasks.deleteTask(t.id);
    dropLegacyLink(ev.id);
    cleared.push(ev.id);
    await log(source, 'clear_block_task', `${ev.blockName}: "${ev.title}" → "${ev.baseTitle}"`);
  }
  return { cleared };
};

const upsertWeekBarRaw = async (weekStartIn: string, text: string, source = 'app') => {
  const weekStart = addDays(weekStartIn, -dowOf(weekStartIn)); // always the Sunday, so one bar per week
  const summary = `Week: ${text.replace(/[\r\n]+/g, ' ').trim()}`;
  const r = await upsertAllDayHelper('Week:', weekStart, addDays(weekStart, 7), summary, '');
  await log(source, 'upsert_week_bar', `${weekStart}: ${summary}`);
  return r;
};

const upsertPlanSummaryRaw = async (date: string, lines: [string, string, string], source = 'app') => {
  const clean = lines.map((l) => String(l ?? '').replace(/[\r\n]+/g, ' ').trim());
  const first = [...clean[0]];
  const head = first.length > 60 ? `${first.slice(0, 59).join('')}…` : clean[0];
  const summary = `Plan: ${head}`;
  const r = await upsertAllDayHelper('Plan:', date, addDays(date, 1), summary, clean.join('\n'));
  await log(source, 'upsert_plan_summary', `${date}: ${summary}`);
  return r;
};

export const setBlockTask = (...a: Parameters<typeof setBlockTaskRaw>) => serial(() => setBlockTaskRaw(...a));
export const clearBlockTask = (...a: Parameters<typeof clearBlockTaskRaw>) => serial(() => clearBlockTaskRaw(...a));
export const upsertWeekBar = (...a: Parameters<typeof upsertWeekBarRaw>) => serial(() => upsertWeekBarRaw(...a));
export const upsertPlanSummary = (...a: Parameters<typeof upsertPlanSummaryRaw>) => serial(() => upsertPlanSummaryRaw(...a));
