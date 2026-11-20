// Shared operations used by both REST routes and MCP tools: today view, capture, priority done. Tasks live in app.db.
import { getDb } from './db.ts';
import { fail } from './errors.ts';
import { hhmm, isDate, weekdayOf, iso, lifeDay, lifeToday } from './time.ts';
import { googleConnected } from './google.ts';
import { listEvents } from './calendar.ts';
import type { CalEvent } from './calendar.ts';
import { getMode } from './sheet.ts';
import { expireRescueMode, modeForDay } from './modeState.ts';
import { mirrorOf, projectFor } from './rules.ts';
import * as tasks from './modules/tasks/store.ts';
import { captureNote } from './notes.ts';
import { getTimer } from './timer.ts';
import { logAction } from './log.ts';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const buildToday = async (date?: string) => {
  // The day rolls at 04:00 local time, like tasks and habits: 01:30 still shows the evening's blocks.
  await expireRescueMode().catch(() => null);
  const d = date ?? lifeToday();
  if (!isDate(d)) fail('bad_request', 'date must be YYYY-MM-DD');
  const warnings: string[] = [];
  const connected = { google: googleConnected() };

  let mode = 'Normal';
  try { mode = modeForDay(d, (await getMode()).mode); } catch (e) { warnings.push(`Mode: ${msg(e)}`); }

  let events: CalEvent[] = [];
  if (!connected.google) warnings.push('Google not connected · Settings → Connect Google');
  else {
    try { events = await listEvents(d); } catch (e) { warnings.push(`Calendar: ${msg(e)}`); }
  }

  const nowMs = Date.now();
  const timed = events.filter((e) => !e.allDay).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const visible = (e: CalEvent) => e.kind === 'block' || e.kind === 'anchor' || e.kind === 'other';
  const now = timed.find((e) => visible(e) && Date.parse(e.start) <= nowMs && nowMs < Date.parse(e.end)) ?? null;
  const next = timed.find((e) => visible(e) && Date.parse(e.start) > nowMs) ?? null;
  const musts = timed.filter((e) => e.kind === 'block' && e.must === true);

  return { date: d, weekday: weekdayOf(d), mode, connected, now, next, events, musts, timer: getTimer(), warnings };
};

/** Tick a block's mirrored app task (tasks.event_id); create the mirror if the block has none yet. */
export const setMustDone = async (eventId: string, done: boolean, source: string) => {
  let t = mirrorOf(eventId);
  if (!t) {
    const { getEvent } = await import('./calendar.ts');
    const ev = await getEvent(eventId);
    if (ev.kind !== 'block') fail('rule_violation', 'Only work blocks can be ticked.');
    const day = ev.allDay ? ev.start.slice(0, 10) : lifeDay(new Date(ev.start));
    t = tasks.addTask({
      title: ev.task || ev.baseTitle, project: projectFor(ev.blockName ?? '', ev.task ?? '') ?? undefined, due_date: day,
      due_time: ev.allDay ? null : hhmm(new Date(ev.start)), est_minutes: ev.minutes ?? null, done_def: ev.done ?? null,
      priority: ev.must ? 3 : 1, source: 'block', event_id: eventId,
    });
  }
  if (done) tasks.completeTask(t.id); else if (t.status !== 'open') tasks.reopenTask(t.id);
  logAction(source, 'must_done', `event ${eventId} → task ${t.id} done=${done}`);
  return { ok: true as const, taskId: t.id };
};

const inflight = new Map<string, Promise<unknown>>();
/** Idempotent capture by clientId, also for two retries arriving at once. */
export const doCapture = (kind: 'task' | 'note', text: string, clientId: string | undefined, source: string) => {
  if (!clientId) return doCaptureOnce(kind, text, clientId, source);
  const running = inflight.get(clientId);
  if (running) return running.then((r) => ({ ...(r as object), duplicate: true }));
  const p = doCaptureOnce(kind, text, clientId, source).finally(() => inflight.delete(clientId));
  inflight.set(clientId, p);
  return p;
};

const doCaptureOnce = async (kind: 'task' | 'note', text: string, clientId: string | undefined, source: string) => {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) fail('bad_request', 'text is required');
  if (kind !== 'task' && kind !== 'note') fail('bad_request', "kind must be 'task' or 'note'");
  if (t.length > 4000) fail('bad_request', 'text too long (max 4000)');
  const db = getDb();
  if (clientId) {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) fail('bad_request', 'bad clientId');
    const prev = db.prepare('SELECT result FROM captures WHERE client_id = ?').get(clientId) as { result: string } | undefined;
    if (prev) return { ...JSON.parse(prev.result), duplicate: true };
  }
  let result: { ok: true; kind: 'task' | 'note'; taskId?: string; path?: string };
  if (kind === 'task') {
    // Lands in the app Inbox (no project, no date).
    const task = tasks.addTask({ title: t.split('\n')[0].slice(0, 250), notes: t.includes('\n') ? t : '', source: 'capture' });
    result = { ok: true, kind, taskId: task.id };
  } else {
    const { path } = await captureNote(t);
    result = { ok: true, kind, path };
  }
  if (clientId) db.prepare('INSERT OR IGNORE INTO captures (client_id, kind, result, ts) VALUES (?, ?, ?, ?)').run(clientId, kind, JSON.stringify(result), iso());
  logAction(source, 'capture', `${kind}: ${t.slice(0, 80)}`);
  return { ...result, duplicate: false };
};
