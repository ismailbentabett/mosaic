// Runs Claude Code headless (stream-json). One run at a time, guarded by the db `claude_lock` row so the
// API server and the nightly CLI never overlap. Events are buffered for late SSE subscribers.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cfg, secret, ROOT, DATA_DIR } from './config.ts';
import { getDb, kvGet, kvSet, pidAlive } from './db.ts';
import { AppError, fail } from './errors.ts';
import { iso } from './time.ts';
import { chatMediaDir, filesPromptBlock, resolveChatFiles, type ChatFile } from './chatfiles.ts';

export type RunEvent = { event: 'text' | 'tool' | 'done'; data: any };
export type ToolUse = { name: string; summary: string };

const RUN_TIMEOUT_MS = 10 * 60_000;
const LOCK_GRACE_MS = 15 * 60_000;
const MAX_EVENTS = 2000;
const KEEP_DONE_MS = 30 * 60_000;

// ---------- stream-json parser (pure) ----------
export type Parsed =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'result'; isError: boolean; text: string; sessionId: string | null }
  | { type: 'raw'; line: string };

export type ParserState = { buf: string; curMsg: string | null; deltaMsgs: Set<string> };
export const newParserState = (): ParserState => ({ buf: '', curMsg: null, deltaMsgs: new Set() });

const clip = (s: unknown, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Short human text for a tool call. */
export const toolSummary = (name: string, input: any = {}): string => {
  const i = input && typeof input === 'object' ? input : {};
  name = name.replace(/^mcp__mosaic__/, '');
  switch (name) {
    case 'set_block_task': return `Updated ${clip(i.task || i.event_id || 'block')}`;
    case 'clear_block_task': return 'Cleared block task';
    case 'upsert_week_bar': return 'Updated week bar';
    case 'upsert_plan_summary': return `Updated plan summary ${clip(i.date, 12)}`;
    case 'tasks_add': return `Added task: ${clip(i.title)}`;
    case 'tasks_update': return `Updated task ${i.id ?? ''}`.trim();
    case 'tasks_done': return i.done === false ? `Reopened task ${i.id}` : `Marked task ${i.id} done`;
    case 'tasks_list': return 'Read tasks';
    case 'capture': return `Captured: ${clip(i.text)}`;
    case 'notes_append': return `Appended to ${clip(i.path)}`;
    case 'notes_read': return `Read ${clip(i.path)}`;
    case 'notes_search': return `Searched notes: ${clip(i.q, 40)}`;
    case 'notes_recent': return 'Read recent notes';
    case 'set_mode': return `Mode → ${clip(i.mode)}`;
    case 'money_read': return 'Read money';
    case 'money_update_totals': return 'Updated money totals';
    case 'push': return `Sent push: ${clip(i.title, 40)}`;
    case 'status': return 'Read status';
    case 'Read': return `Read ${basename(String(i.file_path ?? ''))}`;
    case 'Edit': return `Edited ${basename(String(i.file_path ?? ''))}`;
    case 'Glob': case 'Grep': return `Searched ${clip(i.pattern, 40)}`;
    default: return name.startsWith('get_') || name.startsWith('list_') ? `Read ${name.replace(/^(get|list)_/, '').replace(/_/g, ' ')}` : `Ran ${name}`;
  }
};

/** Parse one NDJSON line. Mutates only `state` (delta bookkeeping). */
export const parseLine = (line: string, state: ParserState): Parsed[] => {
  const s = line.trim();
  if (!s) return [];
  let o: any;
  try { o = JSON.parse(s); } catch { return [{ type: 'raw', line: s }]; }
  if (!o || typeof o !== 'object') return [{ type: 'raw', line: s }];

  if (o.type === 'system' && o.subtype === 'init' && o.session_id) return [{ type: 'session', sessionId: o.session_id }];
  if (o.type === 'stream_event') {
    const ev = o.event ?? {};
    if (ev.type === 'message_start') state.curMsg = ev.message?.id ?? null;
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      state.deltaMsgs.add(state.curMsg ?? '_');
      return [{ type: 'text', text: ev.delta.text }];
    }
    return [];
  }
  if (o.type === 'assistant') {
    const msg = o.message ?? {};
    const streamed = state.deltaMsgs.has(msg.id ?? '_') || (!msg.id && state.deltaMsgs.size > 0);
    const out: Parsed[] = [];
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (b?.type === 'tool_use') {
        const name = String(b.name ?? 'tool').replace(/^mcp__mosaic__/, '');
        out.push({ type: 'tool', name, summary: toolSummary(name, b.input) });
      } else if (b?.type === 'text' && b.text && !streamed) out.push({ type: 'text', text: b.text });
    }
    return out;
  }
  if (o.type === 'result') {
    return [{ type: 'result', isError: !!o.is_error, text: typeof o.result === 'string' ? o.result : '', sessionId: o.session_id ?? null }];
  }
  return [];
};

/** Feed a stdout chunk; returns events for every complete line. Keeps the partial tail in state. */
export const parseChunk = (chunk: string, state: ParserState): Parsed[] => {
  state.buf += chunk;
  const lines = state.buf.split('\n');
  state.buf = lines.pop() ?? '';
  return lines.flatMap((l) => parseLine(l, state));
};
export const flushParser = (state: ParserState): Parsed[] => {
  const rest = state.buf;
  state.buf = '';
  return parseLine(rest, state);
};

/** Usage-limit detection. resetAt: ISO if an epoch/ISO is present, else the human "3pm" text, else null. */
export const detectLimit = (text: string): { limited: boolean; resetAt: string | null } => {
  if (!/usage limit|limit reached|rate limit|hit your limit/i.test(text)) return { limited: false, resetAt: null };
  const epoch = text.match(/\|\s*(\d{10,13})\b/) ?? text.match(/resets?\D{0,10}(\d{10,13})\b/i);
  if (epoch) {
    const n = Number(epoch[1]);
    return { limited: true, resetAt: iso(new Date(n < 1e12 ? n * 1000 : n)) };
  }
  const isoM = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoM && !Number.isNaN(Date.parse(isoM[0]))) return { limited: true, resetAt: isoM[0] };
  const human = text.match(/resets?\s+(?:at\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:[ap]\.?m\.?)?(?:\s*\([^)]+\))?)/i);
  return { limited: true, resetAt: human ? human[1].trim() : null };
};

export const isAuthError = (text: string) => /invalid api key|not logged in|authentication|oauth token|please run \/login/i.test(text);

// ---------- lock ----------
type LockRow = { run_id: string; label: string; pid: number | null; started_at: string };
const lockRow = () => getDb().prepare('SELECT run_id, label, pid, started_at FROM claude_lock WHERE id = 1').get() as LockRow | undefined;
const lockAlive = (r: LockRow) => (r.pid ? pidAlive(r.pid) : Date.now() - Date.parse(r.started_at) < LOCK_GRACE_MS);

export const claudeBusy = (): { busy: boolean; label: string | null } => {
  const r = lockRow();
  if (!r) return { busy: false, label: null };
  if (runs.get(r.run_id)?.done === false || lockAlive(r)) return { busy: true, label: r.label };
  getDb().prepare('DELETE FROM claude_lock WHERE run_id = ?').run(r.run_id); // stale after a crash
  return { busy: false, label: null };
};

const acquireLock = (runId: string, label: string) => {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const b = claudeBusy();
    if (b.busy) throw new AppError('conflict', `Mosaic is busy (${b.label})`, { busy: b.label });
    db.prepare('INSERT OR REPLACE INTO claude_lock (id, run_id, label, pid, started_at) VALUES (1, ?, ?, NULL, ?)').run(runId, label, new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
const releaseLock = (runId: string) => { getDb().prepare('DELETE FROM claude_lock WHERE run_id = ?').run(runId); };

// ---------- runs ----------
type Run = {
  id: string; chatId: string; label: string; child: ChildProcess | null;
  events: RunEvent[]; subs: Set<(e: RunEvent) => void>; done: boolean;
  text: string; tools: ToolUse[]; sessionId: string | null; stopped: boolean; timedOut: boolean;
  result: { isError: boolean; text: string } | null; diag: string[]; error: string | null; limitResetAt: string | null;
};
const runs = new Map<string, Run>();

const emit = (run: Run, e: RunEvent) => {
  const last = run.events[run.events.length - 1];
  // Coalesce stored text so the replay buffer stays small; live subscribers still get each delta.
  if (e.event === 'text' && last?.event === 'text') last.data = { text: last.data.text + e.data.text };
  else if (run.events.length < MAX_EVENTS || e.event === 'done') run.events.push(e.event === 'text' ? { event: 'text', data: { ...e.data } } : e);
  for (const fn of run.subs) { try { fn(e); } catch { /* subscriber gone */ } }
};

// The bundled stdio MCP entry sits next to the bundled server (dist/mcp-stdio.js). MOSAIC_MCP_ENTRY overrides.
const mcpEntry = () => cfg('MOSAIC_MCP_ENTRY', join(dirname(fileURLToPath(import.meta.url)), 'mcp-stdio.js'));

const mcpConfigPath = (source: string) => {
  const safe = source.replace(/[^a-z0-9-]/gi, '') || 'app-claude';
  const env: Record<string, string> = { MOSAIC_SOURCE: safe, MOSAIC_ROOT: ROOT };
  for (const k of ['MOSAIC_DATA', 'MOSAIC_VAULT', 'MOSAIC_SECRETS', 'MOSAIC_DB']) if (process.env[k]) env[k] = process.env[k]!;
  const json = JSON.stringify({ mcpServers: { mosaic: { command: 'node', args: [mcpEntry()], env } } }, null, 2);
  const p = join(DATA_DIR, `mcp-${safe}.json`);
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(p) || readFileSync(p, 'utf8') !== json) writeFileSync(p, json);
  return p;
};

const spawnEnv = () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the subscription OAuth token, never API billing
  const tok = secret('CLAUDE_CODE_OAUTH_TOKEN');
  if (tok) env.CLAUDE_CODE_OAUTH_TOKEN = tok;
  return env;
};

const tail = (s: string, n = 600) => (s.length > n ? '…' + s.slice(-n) : s);

const finish = (run: Run, code: number | null) => {
  if (run.done) return;
  const diag = run.diag.join('\n');
  const limit = detectLimit([run.result?.text ?? '', diag].join('\n'));
  let error: string | null = null;
  if (run.stopped) error = 'Stopped';
  else if (run.timedOut) error = 'Timed out after 10 minutes';
  else if (limit.limited && (run.result?.isError || !run.result)) error = `Usage limit reached${limit.resetAt ? ` (resets ${limit.resetAt})` : ''}`;
  else if (run.result?.isError) error = run.result.text || 'Mosaic reported an error';
  else if (!run.result) error = code === 0 ? 'Mosaic stopped without a reply' : tail(diag.trim()) || `Mosaic exited with code ${code}`;
  if (error && run.error) error = run.error; // spawn errors win
  const authText = [error ?? '', diag].join('\n');
  if (run.result && !run.result.isError) kvSet('claude:lastAuth', JSON.stringify({ ok: true, message: 'ok' }));
  else if (error && isAuthError(authText)) kvSet('claude:lastAuth', JSON.stringify({ ok: false, message: tail(error, 200) }));

  if (!run.text && run.result && !run.result.isError && run.result.text) {
    run.text = run.result.text;
    emit(run, { event: 'text', data: { text: run.result.text } });
  }
  const now = new Date().toISOString();
  try {
    const db = getDb();
    db.prepare('INSERT INTO messages (chat_id, role, text, tools, ts, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.chatId, 'assistant', run.text, JSON.stringify(run.tools), now, error);
    db.prepare('UPDATE chats SET updated = ?, session_id = COALESCE(?, session_id) WHERE id = ?').run(now, run.sessionId, run.chatId);
  } catch (e) {
    console.error('claude finish: could not save reply:', (e as Error).message);
  }
  try { releaseLock(run.id); } catch (e) { console.error('claude finish: releaseLock failed:', (e as Error).message); }

  run.done = true;
  run.error = error;
  run.limitResetAt = limit.limited ? limit.resetAt : null;
  run.child = null;
  emit(run, { event: 'done', data: { chatId: run.chatId, error, limitResetAt: run.limitResetAt } });
  run.subs.clear();
  setTimeout(() => runs.delete(run.id), KEEP_DONE_MS).unref?.();
};

const killChild = (run: Run) => {
  const c = run.child;
  if (!c || c.exitCode !== null) return;
  c.kill('SIGTERM');
  setTimeout(() => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); }, 5000).unref?.();
};

type StartArgs = { prompt: string; chatId?: string; label?: string; source?: string; title?: string; timeoutMs?: number; files?: unknown };

export const startRun = (a: StartArgs): { runId: string; chatId: string } => {
  const files = resolveChatFiles(a.files);
  let prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
  const bare = !prompt && files.length > 0;
  if (bare) prompt = files.length === 1 ? 'Look at this file.' : 'Look at these files.';
  if (!prompt) fail('bad_request', 'prompt is required');
  if (prompt.length > 20000) fail('bad_request', 'prompt too long (max 20000 characters)');
  const db = getDb();
  let sessionId: string | null = null;
  if (a.chatId) {
    const c = db.prepare('SELECT session_id FROM chats WHERE id = ?').get(a.chatId) as { session_id: string | null } | undefined;
    if (!c) fail('not_found', 'Chat not found');
    sessionId = c!.session_id;
  }
  const runId = randomUUID();
  const label = clip(a.label || prompt, 40);
  acquireLock(runId, label);
  try {
    return launch({ ...a, title: a.title || (bare ? files[0].name : undefined) }, runId, label, prompt, sessionId, files);
  } catch (e) {
    runs.delete(runId);
    try { releaseLock(runId); } catch { /* lock row is cleared as stale later */ }
    throw e;
  }
};

/** A chat title from its first message. A voice chat drops the leading "[Voice mode …]" rule, so it is titled from the first spoken words. */
export const chatTitle = (text: string): string =>
  text.replace(/^\s*\[Voice mode[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Voice chat';

const launch = (a: StartArgs, runId: string, label: string, prompt: string, sessionId: string | null, files: ChatFile[] = []): { runId: string; chatId: string } => {
  const db = getDb();
  const now = new Date().toISOString();
  const chatId = a.chatId ?? randomUUID();
  if (!a.chatId) db.prepare('INSERT INTO chats (id, title, session_id, created, updated) VALUES (?, ?, NULL, ?, ?)').run(chatId, chatTitle(a.title || prompt), now, now);
  db.prepare('INSERT INTO messages (chat_id, role, text, tools, ts, files) VALUES (?, ?, ?, ?, ?, ?)').run(chatId, 'user', prompt, '[]', now, JSON.stringify(files));
  db.prepare('UPDATE chats SET updated = ? WHERE id = ?').run(now, chatId);

  const run: Run = {
    id: runId, chatId, label, child: null, events: [], subs: new Set(), done: false, text: '', tools: [],
    sessionId: null, stopped: false, timedOut: false, result: null, diag: [], error: null, limitResetAt: null,
  };
  runs.set(runId, run);

  const full = prompt + filesPromptBlock(files);
  const args = [
    '-p', full.startsWith('-') ? ` ${full}` : full, // a leading "-" would parse as a flag
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--mcp-config', mcpConfigPath(a.source ?? 'app-claude'), '--strict-mcp-config',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'mcp__mosaic Read Glob Grep Edit(vault/**)',
    '--disallowedTools', 'Bash WebFetch WebSearch Task NotebookEdit',
  ];
  if (files.length) args.push('--add-dir', chatMediaDir()); // variadic flag: after the prompt, before --resume
  if (sessionId) args.push('--resume', sessionId);

  let child: ChildProcess;
  try {
    child = spawn(cfg('CLAUDE_BIN', 'claude'), args, { cwd: ROOT, env: spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    run.error = `Could not start Claude: ${(e as Error).message}`;
    finish(run, null);
    return { runId, chatId };
  }
  run.child = child;
  if (child.pid) db.prepare('UPDATE claude_lock SET pid = ? WHERE run_id = ?').run(child.pid, runId);

  const state = newParserState();
  const handle = (items: Parsed[]) => {
    for (const p of items) {
      if (p.type === 'session') run.sessionId = p.sessionId;
      else if (p.type === 'text') { run.text += p.text; emit(run, { event: 'text', data: { text: p.text } }); }
      else if (p.type === 'tool') { run.tools.push({ name: p.name, summary: p.summary }); emit(run, { event: 'tool', data: { name: p.name, summary: p.summary } }); }
      else if (p.type === 'result') { run.result = { isError: p.isError, text: p.text }; if (p.sessionId) run.sessionId = p.sessionId; }
      else if (p.type === 'raw' && run.diag.length < 50) run.diag.push(p.line.slice(0, 500));
    }
  };
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (c: string) => handle(parseChunk(c, state)));
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => { if (run.diag.length < 50) run.diag.push(c.slice(0, 1000)); });

  const timeout = setTimeout(() => { run.timedOut = true; killChild(run); }, a.timeoutMs ?? RUN_TIMEOUT_MS);
  timeout.unref?.();
  child.on('error', (e) => {
    clearTimeout(timeout);
    run.error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Claude CLI not found on this server' : `Claude failed: ${e.message}`;
    finish(run, null);
  });
  child.on('close', (code) => {
    clearTimeout(timeout);
    handle(flushParser(state));
    finish(run, code);
  });
  return { runId, chatId };
};

/** Replays buffered events, then streams live ones. Returns an unsubscribe function. */
export const subscribe = (runId: string, onEvent: (e: RunEvent) => void): (() => void) => {
  const run = runs.get(runId);
  if (!run) fail('not_found', 'Run not found or expired');
  for (const e of [...run!.events]) onEvent(e);
  if (run!.done) return () => {};
  run!.subs.add(onEvent);
  return () => { run!.subs.delete(onEvent); };
};

export const stopRun = (runId: string): boolean => {
  const run = runs.get(runId);
  if (!run || run.done || !run.child) return false;
  run.stopped = true;
  killChild(run);
  return true;
};

/** For the nightly CLI: waits for the lock (polling every 15 s), runs, resolves when done. */
export const runOnce = async (
  prompt: string, label: string,
  opts: { source?: string; timeoutMs?: number; waitForLockMs?: number } = {},
): Promise<{ ok: boolean; text: string; error: string | null; limitResetAt: string | null }> => {
  const deadline = Date.now() + (opts.waitForLockMs ?? 20 * 60_000);
  for (;;) {
    try {
      const { runId } = startRun({ prompt, label, title: label, source: opts.source ?? 'nightly', timeoutMs: opts.timeoutMs });
      return await new Promise((resolve) => {
        subscribe(runId, (e) => {
          if (e.event !== 'done') return;
          const run = runs.get(runId);
          resolve({ ok: !e.data.error, text: run?.text ?? '', error: e.data.error, limitResetAt: e.data.limitResetAt });
        });
      });
    } catch (e) {
      if (!(e instanceof AppError && e.code === 'conflict')) throw e;
      if (Date.now() + 15_000 > deadline) return { ok: false, text: '', error: e.message, limitResetAt: null };
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
};

export const listChats = (): { id: string; title: string; updatedAt: string }[] =>
  (getDb().prepare('SELECT id, title, updated FROM chats ORDER BY updated DESC LIMIT 200').all() as { id: string; title: string; updated: string }[])
    .map((r) => ({ id: r.id, title: r.title, updatedAt: iso(new Date(r.updated)) }));

export const getChat = (id: string) => {
  const db = getDb();
  const c = db.prepare('SELECT id, title FROM chats WHERE id = ?').get(id) as { id: string; title: string } | undefined;
  if (!c) fail('not_found', 'Chat not found');
  const rows = db.prepare('SELECT role, text, tools, ts, error, files FROM messages WHERE chat_id = ? ORDER BY id').all(id) as
    { role: 'user' | 'assistant'; text: string; tools: string; ts: string; error: string | null; files: string | null }[];
  return {
    id: c!.id, title: c!.title,
    messages: rows.map((m) => {
      let tools: ToolUse[] = [];
      let files: ChatFile[] = [];
      try { tools = JSON.parse(m.tools); } catch { /* keep [] */ }
      try { files = JSON.parse(m.files || '[]'); } catch { /* keep [] */ }
      return { role: m.role, text: m.text, tools, ts: iso(new Date(m.ts)), ...(files.length ? { files } : {}), ...(m.error ? { error: m.error } : {}) };
    }),
  };
};

export const lastRunAuth = (): { ok: boolean; message: string } | null => {
  const v = kvGet('claude:lastAuth');
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
};
