// Vault path helpers shared by Notes, Search and the hub.
import * as f from '../../fmt';

const VAULT = 'mosaic-vault';

/** Opens the note in the Obsidian app (vault name is fixed). */
export const obsidianHref = (path: string) =>
  `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`;

export const noteTitle = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Canonical in-app link to a note: /brain/notes/<segment>/<segment>.md, each segment encoded. */
export const noteLink = (path: string) => `/brain/notes/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Neutral source badge for a vault path. */
export function noteSource(path: string): string {
  if (/^log\//i.test(path)) return 'Log';
  if (/^(docs?|brain)\//i.test(path)) return 'Doc';
  if (/^ideas?\//i.test(path)) return 'Idea';
  return 'Note';
}

/** Daily logs are named YYYY-MM-DD: show that day. */
export function noteDay(path: string): string | undefined {
  const m = /(\d{4}-\d{2}-\d{2})(?:\.md)?$/i.exec(path);
  return m ? f.day(m[1]) : undefined;
}

/** Brain search kinds: section label, row badge and where a hit opens. */
export const KIND: Record<string, { label: string; badge: string; href: (id: string) => string }> = {
  note: { label: 'Notes', badge: 'Note', href: (id) => noteLink(id) },
  task: { label: 'Tasks', badge: 'Task', href: () => '/tasks' },
  goal: { label: 'Goals', badge: 'Goal', href: () => '/life/goals' },
  habit: { label: 'Habits', badge: 'Habit', href: () => '/life/habits' },
  record: { label: 'Money', badge: 'Money', href: () => '/life/money' },
  food: { label: 'Food', badge: 'Food', href: () => '/life/food' },
  workout: { label: 'Workouts', badge: 'Workout', href: () => '/life/gym' },
  metric: { label: 'Body', badge: 'Body', href: () => '/life/body' },
};
export const KIND_ORDER = ['note', 'task', 'goal', 'habit', 'record', 'food', 'workout', 'metric'];
export const kindOf = (k: string) => {
  const cap = k ? k[0]!.toUpperCase() + k.slice(1) : 'Item';
  return KIND[k] ?? { label: cap, badge: cap, href: () => '/brain/search' };
};

/** Small localStorage wrapper; blocked storage just means nothing persists. */
export const local = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};
