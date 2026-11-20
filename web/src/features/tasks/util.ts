// Shared helpers for the Tasks feature: views, routes, typed-day parsing and small date labels.
import * as f from '../../fmt';
import { lifeYmd } from '../../time';

/** Every task list the screen can show. `projects` lists one project (or the chip picker). */
export type TaskView = 'today' | 'upcoming' | 'inbox' | 'projects' | 'done' | 'all' | 'needs_day' | 'anytime' | 'someday' | 'waiting';

/** Primary tabs, in order. */
export const PRIMARY: { id: TaskView; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'projects', label: 'Projects' },
];

/** Behind the filter menu: every older view stays reachable. `compost` is its own page. */
export const MORE: { id: TaskView | 'compost'; label: string }[] = [
  { id: 'needs_day', label: 'Needs a day' },
  { id: 'anytime', label: 'Anytime' },
  { id: 'someday', label: 'Someday' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
  { id: 'compost', label: 'Composted' },
];

/** Route segment under /tasks for a view. Today is the index. */
export const VIEW_PATH: Record<TaskView | 'compost', string> = {
  today: '',
  upcoming: 'upcoming',
  inbox: 'inbox',
  projects: 'projects',
  done: 'done',
  all: 'all',
  needs_day: 'needs-day',
  anytime: 'anytime',
  someday: 'someday',
  waiting: 'waiting',
  compost: 'compost',
};

export const tasksPath = (v: TaskView | 'compost', project?: string | null) =>
  '/tasks' + (VIEW_PATH[v] ? '/' + VIEW_PATH[v] : '') + (v === 'projects' && project ? '/' + encodeURIComponent(project) : '');

/** Parse the splat under /tasks into a view and an optional project name. */
export function parseTasksPath(rest: string): { view: TaskView | 'compost'; project: string | null } {
  const [seg = '', id] = rest.split('/');
  const hit = (Object.keys(VIEW_PATH) as (TaskView | 'compost')[]).find((k) => VIEW_PATH[k] === seg);
  const view = hit ?? 'today';
  let project: string | null = null;
  if (view === 'projects' && id) {
    try {
      project = decodeURIComponent(id);
    } catch {
      project = id;
    }
  }
  return { view, project };
}

export const EMPTY: Record<TaskView, string> = {
  today: 'Nothing planned for today. That is allowed.',
  upcoming: 'Nothing scheduled after today.',
  inbox: 'Inbox clear.',
  projects: 'No open tasks in this project.',
  done: 'Nothing finished yet. That is fine.',
  all: 'No tasks yet.',
  needs_day: 'Every task with a date is on a day that is still ahead.',
  anytime: 'No open tasks without a day.',
  someday: 'Nothing parked for someday.',
  waiting: 'Not waiting on anyone.',
};

/**
 * A day, time or repeat typed into the add row ("tomorrow", "fri", "12 nov", "at 3pm", "every mon").
 * When present, the server's parser decides the day; the view's default day is not added.
 */
export const TYPED_DAY =
  /(^|\s)(today|tod|tonight|tomorrow|tmrw?|tom|next\s+week|in\s+\d{1,3}\s+(day|week|month)s?|every\s+\S+|weekly|monthly|yearly|at\s+\d{1,2}|(on\s+)?(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|sday|urday|rsday)?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}|(at\s+)?\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2})(?=\s|$)/i;

/** "today", "tomorrow", "Wed 11 Nov": for use inside a sentence. */
export function dayInline(d: string): string {
  const s = f.day(d);
  return s === 'Today' || s === 'Tomorrow' || s === 'Yesterday' ? s.toLowerCase() : s;
}

/** Group heading: "Tomorrow · Thu 12 Nov" or "Sat 14 Nov". */
export function dayLabel(d: string): string {
  const rel = f.day(d);
  return rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? `${rel} · ${f.dayFull(d)}` : f.dayFull(d);
}

export const tomorrow = () => lifeYmd(Date.now() + 86_400_000);

/** How long a ticked row stays before it leaves the list. */
export const LEAVE_MS = 600;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True when a key event comes from a text field (shortcuts stay quiet). */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
