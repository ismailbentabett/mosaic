import { net } from './store';
import { authHeaders, sessionLost, TOKEN_MODE, url } from './auth';
import { BRAND } from './brand';

// ---- Types (mirror app/API.md) ----
export type Mode = 'Normal' | 'Zero' | 'Family';
export const MODES: Mode[] = ['Normal', 'Zero', 'Family'];

export type CalEvent = {
  id: string;
  title: string;
  baseTitle: string;
  task: string | null;
  kind: 'block' | 'anchor' | 'helper' | 'banner' | 'other';
  blockName: string | null;
  emoji: string | null;
  start: string;
  end: string;
  allDay: boolean;
  ifThen: string | null;
  minutes: number | null;
  done: string | null;
  must: boolean | null;
  /** The app task mirrored from this block (tasks.event_id); taskDone is its done state. */
  taskId?: string | null;
  taskDone?: boolean | null;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  doneAt: string | null;
  due: string | null;
  priority: number;
  projectId: string;
  projectTitle: string;
};

export type Timer = { label: string; startedAt: string; endsAt: string; pausedAt?: string | null; pauseReason?: string | null; pausedMs?: number };
export type PauseReason = 'family' | 'power' | 'other';

export type Check = {
  id: string;
  label: string;
  ok: boolean;
  level: 'ok' | 'warn' | 'error';
  message: string;
  fix: string | null;
  since: string;
};

export type StatusData = { overall: 'ok' | 'warn' | 'error'; checks: Check[]; updatedAt: string };

export type TodayData = {
  date: string;
  weekday: string;
  mode: Mode;
  connected: { google: boolean };
  now: CalEvent | null;
  next: CalEvent | null;
  events: CalEvent[];
  musts: CalEvent[];
  timer: Timer | null;
  warnings: string[];
};

export type Project = { id: string; title: string };
export type TaskView = 'today' | 'inbox' | 'upcoming' | 'done' | 'all';
export type TasksData = { projects: Project[]; tasks: Task[] };
export type NewTask = { title: string; projectId?: string; due?: string; description?: string; priority?: number };
export type TaskPatch = Partial<{ title: string; done: boolean; due: string | null; projectId: string; description: string; priority: number }>;

export type CaptureKind = 'task' | 'note';
export type CaptureResult = { ok: true; kind: CaptureKind; taskId?: string; path?: string; duplicate: boolean };

export type NoteMeta = { path: string; title: string; mtime: string; size: number };
export type RecentNotes = { notes: NoteMeta[]; pinned: { path: string; title: string }[]; today: { path: string; exists: boolean } };
export type SearchResult = { path: string; title: string; line: number; snippet: string };
export type NoteFile = { path: string; content: string; mtime: string };
export type Conflict = { conflict: string; original: string; conflictContent: string; originalContent: string };
export type ConflictAction = 'keep_original' | 'keep_conflict' | 'merge';

export type ChatSummary = { id: string; title: string; updatedAt: string };
export type ToolStep = { name: string; summary: string };
export type ChatFile = { id: string; name: string; type: string; size: number };
export type ChatMessage = { role: 'user' | 'assistant'; text: string; tools: ToolStep[]; ts: string; error?: string; files?: ChatFile[] };
export type Chat = { id: string; title: string; messages: ChatMessage[] };
export type RunDone = { chatId: string; error: string | null; limitResetAt: string | null };

// ---- Errors ----
export class ApiError extends Error {
  code: string;
  status: number;
  body: Record<string, unknown> | null;
  constructor(code: string, message: string, status: number, body: Record<string, unknown> | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export function asApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('client', e instanceof Error ? e.message : String(e), 0);
}

export const MOCK = import.meta.env.VITE_MOCK === '1';
/** Public demo build: mock backend, signed in as the sample user, no login wall. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

type Raw = { status: number; body: unknown; cachedAt: string | null };

async function send(method: string, path: string, body?: unknown): Promise<Raw> {
  if (MOCK) {
    const m = await import('./mock');
    const r = await m.mockFetch(method, path, body);
    return { ...r, cachedAt: null };
  }
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers: { ...authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: TOKEN_MODE ? 'omit' : 'same-origin',
    });
  } catch {
    net.set({ reachable: false });
    throw new ApiError('offline', `No connection to ${BRAND.name}. Check your internet.`, 0);
  }
  if (res.status === 401) {
    sessionLost();
    throw new ApiError('unauthorized', 'Sign in again.', 401);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    if (res.status === 502 || res.status === 504) {
      net.set({ reachable: false });
      throw new ApiError('unreachable', `${BRAND.name} is not answering. Check the server.`, res.status);
    }
    const text = await res.text().catch(() => '');
    return { status: res.status, body: text ? { error: 'http_' + res.status, message: text.slice(0, 200) } : null, cachedAt: null };
  }
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, body: json, cachedAt: res.headers.get('x-mosaic-cached-at') };
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await send(method, path, body);
  const b = (r.body && typeof r.body === 'object' ? r.body : null) as Record<string, unknown> | null;
  if (r.cachedAt) net.set({ reachable: false, cachedAt: r.cachedAt });
  else if (b && b.error === 'offline') net.set({ reachable: false });
  else net.set({ reachable: true, cachedAt: null });
  if (r.status < 200 || r.status >= 300) {
    const code = typeof b?.error === 'string' ? b.error : 'http_' + r.status;
    const msg = typeof b?.message === 'string' ? b.message : `Request failed (${r.status}).`;
    throw new ApiError(code, msg, r.status, b);
  }
  return r.body as T;
}

export const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? '?' + str : '';
};
export const enc = encodeURIComponent;

// ---- Chat files (photos, PDFs, text) ----
async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url(path), { ...init, headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) }, credentials: TOKEN_MODE ? 'omit' : 'same-origin' });
  } catch {
    net.set({ reachable: false });
    throw new ApiError('offline', `No connection to ${BRAND.name}. Check your internet.`, 0);
  }
  if (res.status === 401) {
    sessionLost();
    throw new ApiError('unauthorized', 'Sign in again.', 401);
  }
  return res;
}

async function uploadChatFile(blob: Blob, name: string): Promise<ChatFile> {
  if (MOCK) return (await import('./mock')).mockUpload(blob, name);
  const form = new FormData();
  form.append('file', blob, name);
  const res = await rawFetch('/api/claude/files', { method: 'POST', body: form });
  const b = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 413) throw new ApiError('too_large', 'File too large (max 7 MB).', 413, b);
  if (!res.ok) {
    const code = typeof b?.error === 'string' ? b.error : 'http_' + res.status;
    throw new ApiError(code, typeof b?.message === 'string' ? b.message : `Upload failed (${res.status}).`, res.status, b);
  }
  net.set({ reachable: true, cachedAt: null });
  return b as unknown as ChatFile;
}

const fileUrls = new Map<string, Promise<string>>();

/** Object URL for a chat file. `<img src>` cannot send the sign-in header, so the bytes are fetched once and kept. */
export function chatFileUrl(id: string): Promise<string> {
  let p = fileUrls.get(id);
  if (!p) {
    p = (async () => {
      if (MOCK) {
        const blob = (await import('./mock')).mockFileBlob(id);
        if (!blob) throw new ApiError('not_found', 'File not found', 404);
        return URL.createObjectURL(blob);
      }
      const res = await rawFetch(`/api/claude/files/${enc(id)}`, { method: 'GET' });
      if (!res.ok) throw new ApiError(res.status === 404 ? 'not_found' : 'http_' + res.status, 'File not found', res.status);
      return URL.createObjectURL(await res.blob());
    })();
    p.catch(() => fileUrls.delete(id));
    fileUrls.set(id, p);
  }
  return p;
}

/** Reuse the local preview of a file just sent, so its thumbnail shows without a download. */
export function seedChatFileUrl(id: string, objectUrl: string) {
  if (!fileUrls.has(id)) fileUrls.set(id, Promise.resolve(objectUrl));
}

export const api = {
  me: () => request<{ login: string; name: string }>('GET', '/api/me'),
  status: () => request<StatusData>('GET', '/api/status'),

  today: (date?: string) => request<TodayData>('GET', '/api/today' + q({ date })),
  mustDone: (eventId: string, done: boolean) =>
    request<{ ok: true; taskId: string }>('POST', `/api/today/must/${enc(eventId)}/done`, { done }),

  tasks: (view: TaskView, project?: number | null) => request<TasksData>('GET', '/api/tasks' + q({ view, project })),
  createTask: (t: NewTask) => request<Task>('POST', '/api/tasks', t),
  patchTask: (id: string, p: TaskPatch) => request<Task>('PATCH', `/api/tasks/${id}`, p),

  capture: (kind: CaptureKind, text: string, clientId: string) =>
    request<CaptureResult>('POST', '/api/capture', { kind, text, clientId }),

  notesRecent: () => request<RecentNotes>('GET', '/api/notes/recent'),
  notesSearch: (query: string) => request<{ results: SearchResult[] }>('GET', '/api/notes/search' + q({ q: query })),
  noteFile: (path: string) => request<NoteFile>('GET', '/api/notes/file' + q({ path })),
  saveNote: (path: string, content: string, baseMtime: string) =>
    request<{ mtime: string }>('PUT', '/api/notes/file', { path, content, baseMtime }),
  appendNote: (path: string, text: string) => request<{ mtime: string }>('POST', '/api/notes/append', { path, text }),
  conflicts: () => request<{ conflicts: Conflict[] }>('GET', '/api/notes/conflicts'),
  resolveConflict: (conflict: string, action: ConflictAction, content?: string) =>
    request<{ ok: boolean }>('POST', '/api/notes/conflicts/resolve', { conflict, action, content }),

  mode: () => request<{ mode: Mode; source: 'sheet' | 'cache'; rescue?: { active: boolean; ends_at: string; after: string } | null }>('GET', '/api/mode'),
  setMode: (mode: Mode) => request<{ mode: Mode }>('PUT', '/api/mode', { mode }),

  timer: () => request<Timer | null>('GET', '/api/timer'),
  startTimer: (minutes: number, label: string, taskId?: string | null) => request<Timer>('POST', '/api/timer', { minutes, label, taskId: taskId ?? undefined }),
  stopTimer: () => request<{ ok: boolean }>('DELETE', '/api/timer'),
  pauseTimer: (reason: PauseReason) => request<Timer>('POST', '/api/timer/pause', { reason }),
  resumeTimer: () => request<Timer>('POST', '/api/timer/resume'),

  claudeBusy: () => request<{ busy: boolean; label: string | null }>('GET', '/api/claude/busy'),
  chats: () => request<{ chats: ChatSummary[] }>('GET', '/api/claude/chats'),
  chat: (id: string) => request<Chat>('GET', `/api/claude/chats/${enc(id)}`),
  run: (prompt: string, chatId?: string | null, files?: string[]) =>
    request<{ runId: string; chatId: string }>('POST', '/api/claude/run', { prompt, chatId: chatId || undefined, ...(files?.length ? { files } : {}) }),
  uploadChatFile,
  stopRun: (runId: string) => request<{ ok: boolean }>('POST', `/api/claude/runs/${enc(runId)}/stop`),
};

export type RunHandlers = {
  /** Called before (re)playing the stream: clear the bubble, the server replays from the start. */
  reset(): void;
  text(t: string): void;
  tool(step: ToolStep): void;
  done(d: RunDone): void;
  lost(): void;
};

/** Subscribe to a run's SSE stream. Reconnects replay all events, so handlers.reset() runs first each time. */
export function subscribeRun(runId: string, h: RunHandlers): () => void {
  if (MOCK) {
    let close = () => {};
    let cancelled = false;
    void import('./mock').then((m) => {
      if (!cancelled) close = m.mockSubscribe(runId, h);
    });
    return () => {
      cancelled = true;
      close();
    };
  }
  // fetch-based SSE: EventSource can't send the Bearer header the native apps need.
  let ctrl: AbortController | null = null;
  let finished = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const handle = (event: string, data: string) => {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'text') h.text(String(d.text ?? ''));
    else if (event === 'tool') h.tool({ name: String(d.name ?? ''), summary: String(d.summary ?? d.name ?? '') });
    else if (event === 'done') {
      finished = true;
      ctrl?.abort();
      h.done({
        chatId: String(d.chatId ?? ''),
        error: (d.error as string | null) ?? null,
        limitResetAt: (d.limitResetAt as string | null) ?? null,
      });
    }
  };
  const fail = () => {
    if (finished) return;
    attempts++;
    if (attempts > 15) {
      h.lost();
      return;
    }
    retry = setTimeout(open, Math.min(1000 * attempts, 8000));
  };
  const open = async () => {
    h.reset();
    ctrl = new AbortController();
    try {
      const res = await fetch(url(`/api/claude/runs/${enc(runId)}/events`), {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        credentials: TOKEN_MODE ? 'omit' : 'same-origin',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (res.status === 401) {
        finished = true;
        sessionLost();
        h.lost();
        return;
      }
      if (!res.ok || !res.body) throw new Error('http_' + res.status);
      attempts = 0;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value.replace(/\r\n?/g, '\n');
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          }
          if (data.length) handle(event, data.join('\n'));
          if (finished) return;
        }
      }
      fail();
    } catch {
      fail();
    }
  };
  void open();
  return () => {
    finished = true;
    clearTimeout(retry);
    ctrl?.abort();
  };
}
