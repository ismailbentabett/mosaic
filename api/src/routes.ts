// HTTP surface: REST for the app (/api), MCP over HTTP (/mcp), the web app (static, SPA fallback, sign-in first).
// Listens on 127.0.0.1 only; public Caddy fronts it. Every page and /api call needs the app-password session.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { AppError, fail } from './errors.ts';
import { DEV, PUBLIC_URL, WEB_DIST, cfg } from './config.ts';
import { isDate } from './time.ts';
import { buildToday, setMustDone, doCapture } from './ops.ts';
import * as appTasks from './modules/tasks/store.ts';
import { recentNotes, searchNotes, readNote, writeNote, appendNote, listConflicts, resolveConflict } from './notes.ts';
import { getMode, setMode, canonicalMode } from './sheet.ts';
import { expireRescueMode, recordMode, rescueInfo } from './modeState.ts';
import { getTimer, startTimer, stopTimer, pauseTimer, resumeTimer } from './timer.ts';
import { claudeBusy, listChats, getChat, startRun, subscribe, stopRun } from './claude.ts';
import type { RunEvent } from './claude.ts';
import { readChatFile, saveChatFile } from './chatfiles.ts';
import { releaseBytes, updateInfo } from './releases.ts';
import { googleAuthUrl, googleCallback } from './google.ts';
import { storedStatus } from './health.ts';
import { buildMcpServer } from './tools.ts';
import { modulesRouter } from './modules/routes.ts';
import { pluginsRouter } from './plugins/index.ts';
import { logAction } from './log.ts';
import { performAction } from './modules/extras/store.ts';
import { snoozeTask, cancelTaskPushes } from './notify.ts';
import { checkIngestToken, ingestScreenTime } from './modules/screentime/store.ts';
import { getCookie } from 'hono/cookie';
import { COOKIE, setupMissing, loginBlocked, login, validSession, logout, sessionCookie, clearCookie, loginPage, recoveryLeft } from './auth.ts';

// Origins of the bundled native apps: Capacitor Android (https://localhost) and Tauri on Windows.
const NATIVE_ORIGINS = new Set(['https://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost']);

const SRC = 'app';
const VIEWS = ['today', 'inbox', 'upcoming', 'done', 'all'] as const;

const body = async <T = Record<string, unknown>>(c: Context): Promise<T> => {
  try {
    const b = await c.req.json();
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error();
    return b as T;
  } catch {
    return fail('bad_request', 'Body must be a JSON object');
  }
};
const optStr = (v: unknown, name: string, max = 4000) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) fail('bad_request', `${name} must be text (max ${max})`);
  return v as string;
};
const optPriority = (v: unknown) => {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 5) fail('bad_request', 'priority must be 0–5');
  return v as number;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
const NO_CACHE = new Set(['/sw.js', '/index.html', '/manifest.webmanifest', '/manifest.json']);

/** Path-locked static file from WEB_DIST; null if missing. */
const staticFile = async (urlPath: string) => {
  let p: string;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0') || p.split('/').some((s) => s === '..')) return null;
  const root = await realpath(WEB_DIST).catch(() => null);
  if (!root) return null;
  const full = await realpath(join(root, p)).catch(() => null);
  if (!full || (full !== root && !full.startsWith(root + sep))) return null;
  const st = await stat(full).catch(() => null);
  if (!st || !st.isFile()) return null;
  return { data: await readFile(full), type: MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' };
};

export const buildApp = () => {
  const app = new Hono();

  app.onError((e, c) => {
    if (e instanceof AppError) return c.json(e.toJSON(), e.status as 400);
    console.error('[mosaic-api]', (e as Error)?.stack ?? e);
    return c.json({ error: 'internal', message: 'Server error · see logs/mosaic-api.log' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found', message: 'No such endpoint' }, 404));

  // Private app: no indexing, no framing, no referrer leaks, on every response.
  app.use('*', async (c, next) => {
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.get('/healthz', (c) => c.text('ok'));

  // ---------- Auth ----------
  // One way in: owner email + app password + authenticator code. Web = HttpOnly cookie; native apps
  // (Android/Windows, bundled UI on their own origin) = Bearer token. Caddy fronts us and sets X-Forwarded-For.
  // /mcp over HTTP is closed; Claude reaches the tools through the stdio entry over SSH.
  const publicOrigin = new URL(PUBLIC_URL).origin;
  const clientIp = (c: Context) => (c.req.header('X-Forwarded-For') ?? '').split(',')[0].trim() || 'unknown';
  const safeNext = (v: unknown) =>
    typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.includes(String.fromCharCode(92)) && v.length < 300 && !v.startsWith('/login') ? v : '/';
  const bearer = (c: Context) => (c.req.header('Authorization') ?? '').match(/^Bearer ([A-Za-z0-9_-]{20,100})$/)?.[1];
  const signedInBearer = (c: Context) => validSession(bearer(c));
  const signedIn = (c: Context) => DEV || validSession(getCookie(c, COOKIE)) || signedInBearer(c);
  const setupMsg = () => `Sign-in is locked until setup is done (missing: ${setupMissing().join(', ')}). On the VPS run: bash scheduled/mosaic-connect.sh secure`;

  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

  // CORS for the native apps only (no cookies: they authenticate with a Bearer token).
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    const native = !!origin && NATIVE_ORIGINS.has(origin);
    if (native) {
      c.header('Access-Control-Allow-Origin', origin!);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Max-Age', '600');
    }
    if (c.req.method === 'OPTIONS') return native ? c.body(null, 204) : c.text('Forbidden', 403);
    await next();
  });

  app.use('/login', bodyLimit({ maxSize: 4096, onError: (c) => c.text('Too large', 413) }));
  app.use('/api/auth/*', bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'bad_request', message: 'Too large' }, 413) }));
  app.get('/login', (c) => {
    const next = safeNext(c.req.query('next'));
    if (signedIn(c)) return c.redirect(next, 302);
    c.header('Cache-Control', 'no-store');
    return c.html(loginPage(setupMissing().length ? setupMsg() : '', next));
  });
  type Attempt = { ok: true; token: string } | { ok: false; status: 401 | 429 | 503; error: string };
  const attempt = (c: Context, email: unknown, pw: unknown, code: unknown): Attempt => {
    if (setupMissing().length) return { ok: false, status: 503, error: setupMsg() };
    const ip = clientIp(c);
    const wait = loginBlocked(ip);
    if (wait) return { ok: false, status: 429, error: `Too many tries. Wait ${Math.ceil(wait / 60)} min.` };
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const r = login(ip, str(email, 254), str(pw, 200), str(code, 20), c.req.header('User-Agent') ?? '');
    if (!r.ok) {
      logAction(SRC, 'login_failed', ip);
      return { ok: false, status: 401, error: 'Wrong email, password or code.' };
    }
    logAction(SRC, r.via === 'recovery' ? `login_recovery (${recoveryLeft()} codes left)` : 'login', ip);
    return { ok: true, token: r.token };
  };
  app.post('/login', async (c) => {
    c.header('Cache-Control', 'no-store');
    const origin = c.req.header('Origin');
    if ((origin && origin !== publicOrigin) || c.req.header('Sec-Fetch-Site') === 'cross-site') return c.text('Cross-site request blocked.', 403);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const next = safeNext(form.next);
    const r = attempt(c, form.email, form.password, form.code);
    if (!r.ok) return c.html(loginPage(r.error, next), r.status);
    c.header('Set-Cookie', sessionCookie(r.token));
    return c.redirect(next, 303);
  });
  app.post('/logout', (c) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== publicOrigin) return c.text('Cross-site request blocked.', 403);
    logout(getCookie(c, COOKIE));
    c.header('Set-Cookie', clearCookie());
    return c.redirect('/login', 303);
  });
  // Native apps: JSON login → Bearer token (kept in the app's private storage).
  app.post('/api/auth/login', async (c) => {
    c.header('Cache-Control', 'no-store');
    const origin = c.req.header('Origin');
    if (origin && origin !== publicOrigin && !NATIVE_ORIGINS.has(origin)) return c.json({ error: 'forbidden', message: 'Cross-site request blocked.' }, 403);
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const r = attempt(c, b.email, b.password, b.code);
    if (!r.ok) return c.json({ error: r.status === 401 ? 'unauthorized' : r.status === 429 ? 'rate_limited' : 'locked', message: r.error }, r.status);
    return c.json({ token: r.token });
  });
  app.post('/api/auth/logout', (c) => {
    logout(bearer(c));
    return c.json({ ok: true });
  });

  // ---------- Public, token-scoped (before the session check) ----------
  // ntfy action buttons: a signed, expiring token that can only do one thing to one task.
  app.post('/act/:token', (c) => {
    c.header('Cache-Control', 'no-store');
    const r = performAction(c.req.param('token'));
    if (r.action === 'snooze' && r.task_id) {
      const s = snoozeTask(r.task_id);
      return c.json({ ...r, message: `Again at ${s.at.slice(11, 16)}: ${r.task ?? ''}`.trim(), at: s.at });
    }
    if (typeof r.minutes === 'number') startTimer(r.minutes, String(r.label ?? ''), r.action === 'start' ? r.task_id ?? null : null);
    if (r.task_id && (r.action === 'done' || r.action === 'later')) cancelTaskPushes(r.task_id);
    return c.json(r);
  });
  // Screen-time sync from Android / Windows / browser (ActivityWatch scripts). One ingest token, sha256 in secrets.env.
  app.use('/ingest/*', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'bad_request', message: 'Body too large (max 256 KB)' }, 413) }));
  app.post('/ingest/screentime', async (c) => {
    c.header('Cache-Control', 'no-store');
    const tok = (c.req.header('Authorization') ?? '').match(/^Bearer (\S{20,200})$/)?.[1];
    if (!checkIngestToken(tok)) return c.json({ error: 'unauthorized', message: 'Bad or missing ingest token (cli.js ingest-token).' }, 401);
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return c.json(ingestScreenTime(b.device, b.kind, b.rows, String(b.source ?? 'activitywatch')));
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/mcp' || path.startsWith('/mcp/')) {
      if (!DEV) return c.json({ error: 'forbidden', message: 'MCP over HTTP is off. Use the SSH stdio entry (mcp/README.md).' }, 403);
    } else if (!signedIn(c)) {
      if (path.startsWith('/api/')) return c.json({ error: 'unauthorized', message: 'Sign in again.' }, 401);
      // Nothing is served before sign-in: pages go to the login screen, assets get 401.
      if (c.req.header('Sec-Fetch-Mode') === 'navigate' || path === '/' || !extname(path))
        return c.redirect(`/login?next=${encodeURIComponent(path)}`, 302);
      if (path !== '/sw.js') return c.text('Unauthorized', 401);
    }
    // Bearer requests carry no ambient credential, so another site can't forge them.
    if (bearer(c) && signedInBearer(c)) return next();
    // Block cross-site writes from a browser (another site can't ride the cookie).
    const origin = c.req.header('Origin');
    const write = c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS';
    // Writes: no foreign Origin (incl. "null" from sandboxed frames), no cross-site fetch. GET links from elsewhere still open the app.
    if (write && (c.req.header("Sec-Fetch-Site") === "cross-site" || (origin && origin !== publicOrigin)))
      return c.json({ error: "forbidden", message: "Cross-site request blocked." }, 403);
    if (write && !c.req.path.startsWith("/mcp") && !/^application\/json\b/i.test(c.req.header("Content-Type") ?? "application/json"))
      return c.json({ error: 'bad_request', message: 'Content-Type must be application/json' }, 415);
    await next();
  });
  app.use('/mcp', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'bad_request', message: 'Body too large (max 1 MB)' }, 413) }));
  app.use('/api/*', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: 'bad_request', message: 'Body too large (max 8 MB)' }, 413) }));

  // ---------- Phase 2 modules (tasks, money, food, gym, body, profile, brain) ----------
  // Community plugins: GET /api/v2/plugins lists them, each one's routes live under /api/v2/plugins/<name>/.
  app.route('/api/v2/plugins', pluginsRouter());
  app.route('/api/v2', modulesRouter());

  // ---------- Meta ----------
  app.get('/api/me', (c) => {
    return c.json({ login: 'owner', name: cfg('MOSAIC_OWNER_NAME', 'Sam') });
  });
  app.get('/api/status', (c) => c.json(storedStatus()));

  // ---------- Today ----------
  app.get('/api/today', async (c) => {
    const d = c.req.query('date');
    if (d !== undefined && !isDate(d)) fail('bad_request', 'date must be YYYY-MM-DD');
    return c.json(await buildToday(d));
  });
  app.post('/api/today/must/:eventId/done', async (c) => {
    const b = await body<{ done?: unknown }>(c);
    if (typeof b.done !== 'boolean') fail('bad_request', 'done must be true or false');
    return c.json(await setMustDone(c.req.param('eventId'), b.done as boolean, SRC));
  });

  // ---------- Tasks (simple v1 shape over the app.db task store; /api/v2/tasks is the full API) ----------
  /** Legacy due: YYYY-MM-DD or an ISO date-time (date part kept); null clears. */
  const dueOf = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !isDate(v.slice(0, 10))) return fail('bad_request', 'due must be YYYY-MM-DD or null');
    return v.slice(0, 10);
  };
  const projectOf = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > 100) return fail('bad_request', 'projectId must be a project id');
    if (!appTasks.getProject(v)) fail('not_found', `project ${v} not found`);
    return v;
  };
  // v1 priorities run 0–5; the task store keeps 0–3.
  const prio = (v: unknown) => { const p = optPriority(v); return p === undefined ? undefined : Math.min(3, p); };
  app.get('/api/tasks', (c) => {
    const view = c.req.query('view') ?? 'all';
    if (!(VIEWS as readonly string[]).includes(view)) fail('bad_request', `view must be one of ${VIEWS.join(', ')}`);
    const p = c.req.query('project');
    const projects = appTasks.listProjects().map((x) => ({ id: x.id as string, title: x.name as string }));
    const tasks = appTasks.listTasks({ view: view as (typeof VIEWS)[number], project: p || undefined }).map(appTasks.compat);
    return c.json({ projects, tasks });
  });
  app.post('/api/tasks', async (c) => {
    const b = await body(c);
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 250) fail('bad_request', 'title is required (max 250)');
    const t = appTasks.addTask({ title, project_id: projectOf(b.projectId) ?? null, due_date: dueOf(b.due) ?? null,
      notes: optStr(b.description, 'description'), priority: prio(b.priority), source: SRC });
    logAction(SRC, 'tasks_add', `#${t.id} ${t.title}`);
    return c.json(appTasks.compat(t));
  });
  app.patch('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) fail('bad_request', 'id must be a task id');
    const b = await body(c);
    if (b.title !== undefined && (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 250)) fail('bad_request', 'title must be 1–250 characters');
    if (b.done !== undefined && typeof b.done !== 'boolean') fail('bad_request', 'done must be true or false');
    const t = appTasks.updateTask(id, {
      title: (b.title as string | undefined)?.trim(), due_date: dueOf(b.due), project_id: projectOf(b.projectId),
      notes: optStr(b.description, 'description'), priority: prio(b.priority),
      status: b.done === undefined ? undefined : b.done ? 'done' : 'open',
    });
    logAction(SRC, 'tasks_update', `#${t.id} ${t.title}`);
    return c.json(appTasks.compat(t));
  });

  // ---------- Capture ----------
  app.post('/api/capture', async (c) => {
    const b = await body(c);
    if (b.clientId !== undefined && typeof b.clientId !== 'string') fail('bad_request', 'bad clientId');
    return c.json(await doCapture(b.kind as 'task' | 'note', b.text as string, b.clientId as string | undefined, SRC));
  });

  // ---------- Notes ----------
  app.get('/api/notes/recent', async (c) => c.json(await recentNotes()));
  app.get('/api/notes/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ results: [] });
    if (q.length > 200) fail('bad_request', 'query too long');
    return c.json({ results: await searchNotes(q) });
  });
  app.get('/api/notes/file', async (c) => {
    const p = c.req.query('path');
    if (!p) fail('bad_request', 'path is required');
    return c.json(await readNote(p!));
  });
  app.put('/api/notes/file', async (c) => {
    const b = await body(c);
    if (typeof b.path !== 'string' || typeof b.content !== 'string') fail('bad_request', 'path and content are required');
    if ((b.content as string).length > 2_000_000) fail('bad_request', 'note too large');
    if (b.baseMtime !== null && b.baseMtime !== undefined && typeof b.baseMtime !== 'number') fail('bad_request', 'baseMtime must be a number or null');
    const r = await writeNote(b.path as string, b.content as string, (b.baseMtime as number | null | undefined) ?? null);
    logAction(SRC, 'notes_write', b.path as string);
    return c.json(r);
  });
  app.post('/api/notes/append', async (c) => {
    const b = await body(c);
    if (typeof b.path !== 'string' || typeof b.text !== 'string' || !b.text.trim()) fail('bad_request', 'path and text are required');
    const r = await appendNote(b.path as string, b.text as string);
    logAction(SRC, 'notes_append', b.path as string);
    return c.json(r);
  });
  app.get('/api/notes/conflicts', async (c) => c.json({ conflicts: await listConflicts() }));
  app.post('/api/notes/conflicts/resolve', async (c) => {
    const b = await body(c);
    const actions = ['keep_original', 'keep_conflict', 'merge'];
    if (typeof b.conflict !== 'string' || !actions.includes(b.action as string)) fail('bad_request', 'conflict and action are required');
    if (b.action === 'merge' && typeof b.content !== 'string') fail('bad_request', 'merge needs content');
    const r = await resolveConflict(b.conflict as string, b.action as 'keep_original' | 'keep_conflict' | 'merge', b.content as string | undefined);
    logAction(SRC, 'conflict_resolve', `${b.conflict} → ${b.action}`);
    return c.json(r ?? { ok: true });
  });

  // ---------- Mode ----------
  app.get('/api/mode', async (c) => {
    await expireRescueMode().catch(() => null);
    return c.json({ ...(await getMode()), rescue: rescueInfo() });
  });
  app.put('/api/mode', async (c) => {
    const b = await body(c);
    const m = canonicalMode(b.mode);
    if (!m) fail('bad_request', 'mode must be Normal, Zero or Family');
    const r = await setMode(m!);
    recordMode(m!, 'user');
    logAction(SRC, 'set_mode', m!);
    return c.json(r);
  });

  // ---------- Timer ----------
  app.get('/api/timer', (c) => c.json(getTimer()));
  app.post('/api/timer', async (c) => {
    const b = await body(c);
    const minutes = b.minutes ?? 50;
    if (!Number.isInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 240) fail('bad_request', 'minutes must be 1–240');
    const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 100) : 'Focus';
    const taskId = typeof b.taskId === 'string' && b.taskId ? b.taskId : null;
    return c.json(startTimer(minutes as number, label, taskId));
  });
  app.delete('/api/timer', (c) => { stopTimer(); return c.json({ ok: true }); });
  app.post('/api/timer/pause', async (c) => { const b = await body(c); return c.json(pauseTimer(typeof b.reason === 'string' ? b.reason : 'other')); });
  app.post('/api/timer/resume', (c) => c.json(resumeTimer()));

  // ---------- Claude ----------
  app.get('/api/claude/busy', (c) => c.json(claudeBusy()));
  app.get('/api/claude/chats', (c) => c.json({ chats: listChats() }));
  app.get('/api/claude/chats/:id', (c) => c.json(getChat(c.req.param('id'))));
  app.post('/api/claude/run', async (c) => {
    const b = await body(c);
    if (b.chatId !== undefined && typeof b.chatId !== 'string') fail('bad_request', 'bad chatId');
    return c.json(startRun({ prompt: b.prompt as string, chatId: b.chatId as string | undefined, files: b.files, source: 'app-claude' }));
  });
  // Photos and files for chat: multipart field "file". Saved under DATA_DIR/media/chat, read by Claude.
  app.post('/api/claude/files', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const f = (form as Record<string, unknown>).file;
    if (!f || typeof f === 'string' || typeof (f as File).arrayBuffer !== 'function') fail('bad_request', 'Send the file in a "file" field.');
    const file = f as File;
    return c.json(saveChatFile(file.name || '', file.type || '', new Uint8Array(await file.arrayBuffer())), 201);
  });
  app.get('/api/claude/files/:id', (c) => {
    const { file, bytes } = readChatFile(c.req.param('id'));
    const image = file.type.startsWith('image/');
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': image || file.type === 'application/pdf' ? file.type : 'text/plain; charset=utf-8',
      'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="${file.name.replace(/[^\w. -]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });
  // Self-hosted app updates (releases.ts). The apps poll this, then download and install the file.
  app.get('/api/app/update', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(updateInfo());
  });
  app.get('/api/app/update/:platform', (c) => {
    const { file, bytes } = releaseBytes(c.req.param('platform'));
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': file.file.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file.file}"`,
      'Content-Length': String(file.size),
      'X-Sha256': file.sha256,
      'Cache-Control': 'no-store',
    });
  });
  app.get('/api/claude/runs/:runId/events', (c) => {
    const runId = c.req.param('runId');
    // Throws not_found before the stream opens if the run is unknown.
    const queue: RunEvent[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe(runId, (e) => { queue.push(e); wake?.(); });
    return streamSSE(c, async (s) => {
      let closed = false;
      s.onAbort(() => { closed = true; unsub(); wake?.(); });
      let lastBeat = Date.now();
      try {
        while (!closed) {
          while (queue.length) {
            const e = queue.shift()!;
            await s.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
            if (e.event === 'done') return;
          }
          await new Promise<void>((r) => { wake = r; setTimeout(r, 15_000); });
          wake = null;
          if (!queue.length && Date.now() - lastBeat >= 15_000) { await s.write(': ping\n\n'); lastBeat = Date.now(); }
        }
      } finally { unsub(); }
    });
  });
  app.post('/api/claude/runs/:runId/stop', (c) => c.json({ ok: stopRun(c.req.param('runId')) }));

  // ---------- Google connect ----------
  app.get('/api/google/connect', (c) => c.redirect(googleAuthUrl(), 302));
  app.get('/api/google/callback', async (c) => {
    const err = c.req.query('error');
    if (err) return c.redirect(`/#/settings?google=error&reason=${encodeURIComponent(err.slice(0, 80))}`, 302);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.redirect('/#/settings?google=error&reason=missing_code', 302);
    try {
      await googleCallback(code, state);
      logAction(SRC, 'google_connect', 'refresh token saved');
      return c.redirect('/#/settings?google=ok', 302);
    } catch (e) {
      const reason = e instanceof AppError ? e.message : 'exchange_failed';
      return c.redirect(`/#/settings?google=error&reason=${encodeURIComponent(reason.slice(0, 120))}`, 302);
    }
  });

  // ---------- MCP (stateless streamable HTTP; PC Claude Code) ----------
  app.all('/mcp', async (c) => {
    const server = buildMcpServer('pc-claude');
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // JSON responses are complete once returned; close frees the per-request server.
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    }
  });

  // ---------- PWA ----------
  app.get('*', async (c) => {
    const path = c.req.path;
    if (path.startsWith('/api/')) return c.json({ error: 'not_found', message: 'No such endpoint' }, 404);
    const f = (path !== '/' && (await staticFile(path))) || (!extname(path) || path === '/' ? await staticFile('/index.html') : null);
    if (!f) return c.text('Not found', 404);
    const isShell = NO_CACHE.has(path) || path === '/' || !extname(path);
    const cache = isShell ? 'no-cache' : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    return c.body(f.data, 200, { 'Content-Type': f.type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  });

  return app;
};
