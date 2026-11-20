// Google Calendar events: list/get as CalEvent, patch summary/description only, upsert all-day helpers.
import { cfg } from './config.ts';
import { getDb } from './db.ts';
import { fail } from './errors.ts';
import { googleFetch } from './google.ts';
import { TZ, dayEnd, dayStart } from './time.ts';
import { classify, parseDescription, parseTitle } from './rules.ts';

export type CalEvent = {
  id: string;
  title: string;
  baseTitle: string;
  task: string | null;
  kind: 'block' | 'anchor' | 'helper' | 'banner' | 'other';
  blockName: string | null;
  emoji: string | null;
  start: string; end: string; allDay: boolean;
  ifThen: string | null;
  minutes: number | null;
  done: string | null;
  must: boolean | null;
  /** Mirrored app task (tasks.event_id) and its done state. */
  taskId: string | null;
  taskDone: boolean | null;
};

/** Raw Google event (fields we read). */
export type GEvent = {
  id: string; status?: string; summary?: string; description?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
};

const base = () => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg('GOOGLE_CALENDAR_ID', 'primary'))}/events`;

/** Pure: Google event → CalEvent without app-task fields. Exported for tests. */
export const toCalEvent = (g: GEvent): CalEvent => {
  const title = g.summary ?? '';
  const allDay = !!g.start?.date && !g.start?.dateTime;
  const { baseTitle, task } = parseTitle(title);
  const c = classify(title, allDay);
  const d = parseDescription(g.description ?? '');
  return {
    id: g.id, title, baseTitle, task, kind: c.kind, blockName: c.blockName, emoji: c.emoji,
    start: g.start?.dateTime ?? g.start?.date ?? '', end: g.end?.dateTime ?? g.end?.date ?? '', allDay,
    ifThen: d.ifThen, minutes: d.minutes, done: d.done, must: task ? d.must : null,
    taskId: null, taskDone: null,
  };
};

/** Raw events.list for one local day (cancelled skipped). */
export const rawDayEvents = async (date: string): Promise<GEvent[]> => {
  const q = new URLSearchParams({
    singleEvents: 'true', orderBy: 'startTime', timeZone: TZ,
    timeMin: dayStart(date), timeMax: dayEnd(date), maxResults: '250',
  });
  const j = await googleFetch(`${base()}?${q}`);
  return ((j?.items ?? []) as GEvent[]).filter((e) => e.status !== 'cancelled');
};

/** Decorates events with their mirrored app task (tasks.event_id, newest live row). */
const withTasks = (evs: CalEvent[]): CalEvent[] => {
  if (!evs.length) return evs;
  try {
    const ids = evs.map((e) => e.id);
    const rows = getDb()
      .prepare(`SELECT id, status, event_id FROM tasks WHERE deleted_at IS NULL AND event_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`)
      .all(...ids) as { id: string; status: string; event_id: string }[];
    const by = new Map(rows.map((r) => [r.event_id, r]));
    for (const e of evs) {
      const r = by.get(e.id);
      e.taskId = r?.id ?? null;
      e.taskDone = r ? r.status === 'done' : null;
    }
  } catch { /* tasks table missing (fresh test DB): leave null */ }
  return evs;
};

export const listEvents = async (date: string): Promise<CalEvent[]> =>
  withTasks((await rawDayEvents(date)).map(toCalEvent));

/** CalEvent plus the raw description (CalEvent itself has none; rules.ts needs it to keep original text). */
export const getEventRaw = async (id: string): Promise<{ event: CalEvent; description: string }> => {
  const g = (await googleFetch(`${base()}/${encodeURIComponent(id)}?timeZone=${encodeURIComponent(TZ)}`)) as GEvent;
  if (!g || g.status === 'cancelled') fail('not_found', `Event ${id} not found.`);
  return { event: withTasks([toCalEvent(g)])[0], description: g.description ?? '' };
};

export const getEvent = async (id: string): Promise<CalEvent> => (await getEventRaw(id)).event;

/** Only summary/description are ever sent. Never colour, time, attendees, reminders or recurrence. */
export const patchEvent = async (id: string, p: { summary?: string; description?: string }): Promise<void> => {
  const body: { summary?: string; description?: string } = {};
  if (typeof p.summary === 'string') body.summary = p.summary;
  if (typeof p.description === 'string') body.description = p.description;
  if (!Object.keys(body).length) return;
  await googleFetch(`${base()}/${encodeURIComponent(id)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify(body) });
};

export const upsertAllDayHelper = async (
  prefix: 'Week:' | 'Plan:', startDate: string, endDateExclusive: string, summary: string, description: string,
): Promise<{ id: string; created: boolean }> => {
  const found = (await rawDayEvents(startDate)).find(
    (e) => e.start?.date === startDate && !e.start?.dateTime && (e.summary ?? '').startsWith(prefix),
  );
  if (found) {
    await patchEvent(found.id, { summary, description });
    return { id: found.id, created: false };
  }
  const j = await googleFetch(`${base()}?sendUpdates=none`, {
    method: 'POST',
    body: JSON.stringify({
      summary, description, start: { date: startDate }, end: { date: endDateExclusive }, transparency: 'transparent',
    }),
  });
  return { id: String(j?.id ?? ''), created: true };
};
