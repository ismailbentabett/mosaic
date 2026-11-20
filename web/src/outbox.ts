import { ApiError, asApiError, request, type CaptureKind } from './api';
import { emit, net, toast } from './store';
import { BRAND } from './brand';

/**
 * The one offline queue. Every write that can wait (quick captures and v2 creates) is kept here,
 * in IndexedDB, and replayed in order when the server is reachable. Each item carries a client id;
 * the server keeps the first row per id, so a replay never makes a duplicate.
 *
 * An item the server refuses for good (400, 404, 409 conflict, 422 rule violation) moves to the
 * "Unsent" list with the server's message, where it can be retried or discarded. Nothing is dropped
 * silently. Network trouble (offline, 5xx gateway, 401, 408, 429) keeps the item queued.
 */
export type OutboxItem = {
  id: string;
  method: string;
  path: string;
  body: unknown;
  createdAt: string;
  label: string;
  error?: string;
  /** Set for quick captures (task / note); counts toward `net.queued` and refreshes tasks or notes when sent. */
  capture?: CaptureKind;
};

/** What happened to one capture. `sent` false = safe on this device, sends when the server is reachable. */
export type CaptureOut = { sent: boolean; clientId: string; kind: CaptureKind; path?: string };

const DB_NAME = 'mosaic-outbox';
const LIVE = 'items';
const DEAD = 'dead';
let dbPromise: Promise<IDBDatabase> | null = null;
let fallback: Record<string, OutboxItem[]> | null = null; // in-memory when IndexedDB is unavailable

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(LIVE, { keyPath: 'id' });
        req.result.createObjectStore(DEAD, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function listOf(store: string): Promise<OutboxItem[]> {
  if (fallback) return [...(fallback[store] ?? [])];
  try {
    const rows = await tx(store, 'readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>);
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    fallback = { [LIVE]: [], [DEAD]: [] };
    return [];
  }
}

async function putIn(store: string, item: OutboxItem) {
  if (!fallback) {
    try {
      await tx(store, 'readwrite', (s) => s.put(item));
      return;
    } catch {
      fallback = { [LIVE]: [], [DEAD]: [] };
    }
  }
  const arr = (fallback[store] ??= []);
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item;
  else arr.push(item);
}

async function removeFrom(store: string, id: string) {
  if (fallback) {
    fallback[store] = (fallback[store] ?? []).filter((x) => x.id !== id);
    return;
  }
  await tx(store, 'readwrite', (s) => s.delete(id));
}

async function refresh() {
  const [live, dead] = await Promise.all([listOf(LIVE), listOf(DEAD)]);
  const captures = live.filter((i) => i.capture).length;
  net.set({ queued: captures, outbox: live.length - captures, deadLetters: dead.length });
}

/** A short human label for a queued write: "money/records" → "money records: note". */
export function labelFor(path: string, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = [b.text, b.title, b.name, b.note].find((v) => typeof v === 'string') as string | undefined;
  const what = path.replace(/^\/api\/(v2\/)?/, '').split('/').filter((p) => !/^[0-9a-f-]{8,}$/i.test(p)).join(' ');
  return text ? `${what}: ${text.slice(0, 60)}` : what;
}

export const isOffline = (e: unknown) => {
  const err = asApiError(e);
  return err.code === 'offline' || err.code === 'unreachable' || err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
};

/** Refused for good: kept under Unsent with the server's message. 401/408/429 are temporary. */
export const rejected = (status: number) => status >= 400 && status < 500 && ![401, 408, 429].includes(status);

/** Send a create; if the server is unreachable, queue it and throw a calm "saved offline" error. */
export async function sendOrQueue<T>(method: string, path: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await request<T>(method, path, body);
  } catch (e) {
    if (!isOffline(e) || typeof body.id !== 'string') throw e;
    await putIn(LIVE, { id: body.id, method, path, body, createdAt: new Date().toISOString(), label: labelFor(path, body) });
    await refresh();
    throw new ApiError('queued', `Saved on this phone. It sends when ${BRAND.name} is back.`, 0);
  }
}

/* ---- Captures (quick add, voice, share) ---- */

/** The request a capture becomes. A task goes to the app task list (client id = task id), a note to today's log. */
function captureRequest(kind: CaptureKind, text: string, clientId: string, project?: string, legacy = false) {
  if (kind === 'task' && !legacy) {
    const lines = text.trim().split(/\r?\n/);
    const first = lines[0].trim();
    const notes = lines.slice(1).join('\n').trim();
    const body: Record<string, unknown> = { id: clientId, text: first || text.trim() };
    if (notes) body.notes = notes;
    if (project) body.project = project; // omitted = Inbox
    return { method: 'POST', path: '/api/v2/tasks', body };
  }
  return { method: 'POST', path: '/api/capture', body: { kind, text, clientId } };
}

function captureEntry(kind: CaptureKind, text: string, clientId: string, createdAt: string, project?: string, legacy = false): OutboxItem {
  const r = captureRequest(kind, text, clientId, project, legacy);
  return { id: clientId, ...r, createdAt, label: `${kind}: ${text.trim().slice(0, 60)}`, capture: kind };
}

const results = new Map<string, { path?: string }>();
let flushing: Promise<number> | null = null;

/** Replays queued writes in order. Stops at the first network failure. Returns how many were sent. */
export function flushOutbox(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let other = 0;
    let tasks = false;
    let notes = false;
    try {
      for (const item of await listOf(LIVE)) {
        try {
          const r = await request<{ path?: string }>(item.method, item.path, item.body);
          if (item.capture) {
            if (results.size > 50) results.clear();
            results.set(item.id, { path: r && typeof r === 'object' ? r.path : undefined });
            if (item.capture === 'task') tasks = true;
            else notes = true;
          } else other++;
          await removeFrom(LIVE, item.id);
          sent++;
        } catch (e) {
          const err = asApiError(e);
          if (rejected(err.status)) {
            await removeFrom(LIVE, item.id);
            await putIn(DEAD, { ...item, error: err.message });
            toast(`Not accepted: ${item.label}. ${err.message} Kept under Unsent.`, { timeout: 12000 });
            continue;
          }
          break;
        }
      }
    } finally {
      await refresh();
      flushing = null;
      if (tasks) emit('tasks');
      if (notes) emit('notes');
    }
    if (other > 0) toast(`Sent ${other} saved ${other === 1 ? 'item' : 'items'}`);
    return sent;
  })();
  return flushing;
}

/** Old name, same queue. */
export const flush = flushOutbox;

/** Queue a capture and try to send it right away. */
export async function captureItem(kind: CaptureKind, text: string, o: { project?: string } = {}): Promise<CaptureOut> {
  const clientId = crypto.randomUUID();
  await putIn(LIVE, captureEntry(kind, text, clientId, new Date().toISOString(), kind === 'task' ? o.project : undefined));
  await refresh();
  const busy = flushing !== null; // a running flush took its list before this item
  await flushOutbox();
  if (busy) await flushOutbox();
  const live = await listOf(LIVE);
  const sent = !live.some((i) => i.id === clientId);
  if (sent && (await listOf(DEAD)).some((i) => i.id === clientId)) {
    // Refused by the server: it is under Unsent with the reason, not lost.
    throw new ApiError('rejected', 'Not accepted. Kept under Unsent.', 400);
  }
  const r = results.get(clientId);
  results.delete(clientId);
  return { sent, clientId, kind, path: r?.path };
}

/** Queue a capture and try to send it right away. Returns true if it reached the server. */
export async function capture(kind: CaptureKind, text: string): Promise<boolean> {
  return (await captureItem(kind, text)).sent;
}

/** Drops a queued write that has not been sent yet (Undo). True if it was still waiting. */
export async function cancel(id: string): Promise<boolean> {
  if (flushing) await flushing.catch(() => 0); // it may be on its way right now
  const waiting = (await listOf(LIVE)).some((i) => i.id === id);
  if (waiting) await removeFrom(LIVE, id);
  await refresh();
  return waiting;
}

export const outboxItems = () => listOf(LIVE);
export const deadLetters = () => listOf(DEAD);

/** Try an Unsent item again (after the cause is fixed). */
export async function retryDead(id: string) {
  const item = (await listOf(DEAD)).find((x) => x.id === id);
  if (!item) return;
  await removeFrom(DEAD, id);
  await putIn(LIVE, { ...item, error: undefined });
  await refresh();
  await flushOutbox();
}

/** Let an Unsent item go. Only the person can do this; the app never discards on its own. */
export async function discardDead(id: string) {
  await removeFrom(DEAD, id);
  await refresh();
}

let started = false;

export function startOutbox() {
  if (started) return;
  started = true;
  void refresh().then(() => flushOutbox());
  window.addEventListener('online', () => void flushOutbox());
  window.addEventListener('focus', () => void flushOutbox());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
  setInterval(() => {
    const n = net.get();
    if (n.outbox > 0 || n.queued > 0) void flushOutbox();
  }, 30000);
}

/** Old name for the same start-up. */
export const startQueue = startOutbox;
