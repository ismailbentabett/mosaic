// The `mosaic` MCP server. Same tools over HTTP (/mcp, source pc-claude) and stdio (MOSAIC_SOURCE).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError } from './errors.ts';
import { today, isDate } from './time.ts';
import { buildToday, doCapture } from './ops.ts';
import { listBlocks, setBlockTask, clearBlockTask, upsertWeekBar, upsertPlanSummary } from './rules.ts';
import { getMode, setMode, canonicalMode, moneyRead, moneyUpdateTotals } from './sheet.ts';
import { expireRescueMode, recordMode, rescueInfo } from './modeState.ts';
import { registerTaskTools, registerModuleTools } from './modules/tools.ts';
import { pluginTools } from './plugins/index.ts';
import { quickAdd, compat } from './modules/tasks/store.ts';
import { searchNotes, readNote, appendNote, recentNotes } from './notes.ts';
import { PUSH_CATS } from './ntfy.ts';
import * as pc from './pushCenter.ts';
import { storedStatus } from './health.ts';
import { logAction } from './log.ts';

type Out = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (v: unknown): Out => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const err = (e: unknown): Out => {
  const body = e instanceof AppError ? e.toJSON() : { error: 'internal', message: (e as Error)?.message ?? String(e) };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError: true };
};
const wrap = <A>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A): Promise<Out> => {
  try { return ok(await fn(a)); } catch (e) { return err(e); }
};

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Default today.');
export const buildMcpServer = (source: string) => {
  const s = new McpServer({ name: 'mosaic', version: '2.0.0' });
  const reg = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: z.infer<z.ZodObject<S>>) => unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s.registerTool as any)(name, { description, inputSchema: shape }, wrap(fn as any));

  // ---------- Day ----------
  reg('get_today', 'Today view: mode, now/next event, all events, the 3 priority blocks, timer, warnings.',
    { date: dateArg }, (a) => buildToday(a.date));
  reg('get_mode',
    'Current mode (Normal | Zero | Family) from the Sheet. `rescue` is set when Zero came from Rescue: it ends at the next 04:00 unless kept; plan tomorrow in `rescue.after`.',
    {}, async () => {
      await expireRescueMode().catch(() => null);
      return { ...(await getMode()), rescue: rescueInfo() };
    });
  reg('set_mode', 'Set the mode in the Sheet `mode` cell.', { mode: z.string() }, async (a) => {
    const m = canonicalMode(a.mode);
    if (!m) throw new AppError('bad_request', 'mode must be Normal, Zero or Family');
    const r = await setMode(m);
    recordMode(m, 'user');
    logAction(source, 'set_mode', m);
    return r;
  });

  // ---------- Calendar ----------
  reg('list_blocks', 'Writable work blocks for a day (the only events whose titles may change).',
    { date: dateArg }, (a) => listBlocks(a.date ?? today()));
  reg('set_block_task',
    'Append " · task" to one block instance and write the 3-line description. Enforces all calendar rules; on rule_violation change the task and retry.',
    {
      event_id: z.string().min(1),
      task: z.string().min(1).describe('Verb first, under 45 characters, one task.'),
      first_action: z.string().min(1).describe('First action under 2 minutes (goes into the IF-THEN line).'),
      minutes: z.number().int().min(5).max(240),
      done: z.string().min(1).describe('Definition of done.'),
      must: z.boolean(),
      project: z.string().optional().describe('App project for the mirrored task (optional; derived from the block when left out).'),
    }, (a) => setBlockTask(a, source));
  reg('clear_block_task', 'Strip " · …" from one block (event_id) or all blocks of a date.',
    { event_id: z.string().optional(), date: dateArg }, (a) => {
      if (!a.event_id && !a.date) throw new AppError('bad_request', 'give event_id or date');
      return clearBlockTask(a, source);
    });
  reg('upsert_week_bar', 'Create or update the all-day "Week: …" helper bar for the week containing weekStart (stored on that week\'s Sunday, one bar per week).',
    { weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().min(1).max(200) },
    (a) => upsertWeekBar(a.weekStart, a.text, source));
  reg('upsert_plan_summary', 'Create or update the "Plan: …" helper event for a day with exactly 3 lines.',
    { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), lines: z.array(z.string().min(1).max(200)).length(3) },
    (a) => upsertPlanSummary(a.date, a.lines as [string, string, string], source));

  // ---------- Tasks (SQLite) ----------
  registerTaskTools(reg, source);
  reg('capture', 'Quick capture. kind task → app Inbox (natural text parsed); kind note → vault/Log/<today>.md.',
    { kind: z.enum(['task', 'note']), text: z.string().min(1).max(4000) },
    (a) => {
      if (a.kind === 'note') return doCapture('note', a.text, undefined, source);
      const t = quickAdd(a.text.split('\n')[0].slice(0, 250), { notes: a.text.includes('\n') ? a.text : undefined, source });
      logAction(source, 'capture', `task ${t.id}`);
      return { ok: true, kind: 'task', task: compat(t) };
    });

  // ---------- Notes (vault) ----------
  reg('notes_search', 'Search the vault (filenames and content). Max 50 results.',
    { q: z.string().min(1).max(200) }, async (a) => ({ results: await searchNotes(a.q) }));
  reg('notes_read', 'Read one vault note. path is relative to the vault, e.g. Log/2026-11-11.md.',
    { path: z.string().min(1) }, (a) => readNote(a.path));
  reg('notes_append', 'Append text to a vault note under a dated heading (append only).',
    { path: z.string().min(1), text: z.string().min(1).max(20000) }, async (a) => {
      const r = await appendNote(a.path, a.text);
      logAction(source, 'notes_append', a.path);
      return r;
    });
  reg('notes_recent', 'Recently changed notes, pinned notes and today\'s log path.', {}, () => recentNotes());

  // ---------- Sheet ----------
  reg('money_read', 'Rules+Money tab as key → value (totals only, plus Doc index).', {}, () => moneyRead());
  reg('money_update_totals', 'Update numeric totals in the Rules+Money tab. Keys must already exist.',
    { values: z.record(z.string(), z.number()) }, async (a) => {
      const r = await moneyUpdateTotals(a.values);
      logAction(source, 'money_update_totals', r.updated.join(', '));
      return r;
    });

  // ---------- Misc ----------
  const cat = z.enum(PUSH_CATS);
  reg('push', 'Send a phone push now (ntfy, brand Mosaic). Goes through switches, quiet hours (sleep, Saturday, mode) and the hourly cap: returns status sent | held (with until) | muted | deduped | failed. Use sparingly. click: a screen key (today, tasks, money, gym, notifications…) or URL.',
    { title: z.string().min(1).max(100), body: z.string().min(1).max(1000), priority: z.number().int().min(1).max(5).optional(), cat: cat.optional(), click: z.string().max(300).optional(), key: z.string().max(80).optional() },
    async (a) => {
      const r = await pc.sendPush({ title: a.title, message: a.body, priority: a.priority, cat: a.cat, click: a.click, key: a.key });
      logAction(source, 'push', `${a.title} → ${r.status}`);
      return { ok: r.status !== 'failed', ...r };
    });
  reg('push_at', 'Remind him later: one push at a time. at = HH:MM (next time it comes) or ISO. task_id = remind about that task with Done/Start/Snooze buttons (title optional then). Same key replaces an older one.',
    { at: z.string().min(4).max(40), title: z.string().max(100).optional(), body: z.string().max(1000).optional(), priority: z.number().int().min(1).max(5).optional(), cat: cat.optional(), task_id: z.string().max(80).optional(), key: z.string().max(80).optional() },
    (a) => { const r = pc.scheduleAdd({ ...a, message: a.body }); logAction(source, 'push_at', `${r.at} ${r.title}`); return r; });
  reg('push_scheduled', 'List pushes waiting for their time, or cancel one (cancel_id).',
    { cancel_id: z.number().int().optional() },
    (a) => { if (a.cancel_id !== undefined) { pc.scheduleCancel(a.cancel_id); logAction(source, 'push_cancel', String(a.cancel_id)); } return pc.scheduledItems(); });
  reg('push_status', 'Notifications now: quiet or not (reason, until), held count, coming reminders today, counts for the last 24 h, last push sent.',
    {}, () => pc.pushStatus());
  reg('push_prefs', 'Read or change notification settings: cats {tasks, blocks, timer, gym, brief, docs, wishlist, nightly, ops, custom: on/off}, block_lead_min (0-30), hourly_cap (1-30), snooze_min (5-120). No args = read.',
    { cats: z.record(z.string(), z.boolean()).optional(), block_lead_min: z.number().int().min(0).max(30).optional(), hourly_cap: z.number().int().min(1).max(30).optional(), snooze_min: z.number().int().min(5).max(120).optional() },
    (a) => {
      if (a.cats === undefined && a.block_lead_min === undefined && a.hourly_cap === undefined && a.snooze_min === undefined) return pc.pushPrefs();
      const r = pc.updatePushPrefs(a); logAction(source, 'push_prefs', JSON.stringify(a)); return r;
    });
  reg('push_log', 'What was pushed: newest first, with status (sent, held, muted, deduped, failed) and reason. Answer "did I get…", "why no ping".',
    { limit: z.number().int().min(1).max(500).optional(), cat: cat.optional() }, (a) => pc.pushLogList(a.limit, a.cat));
  reg('push_held', 'Pushes waiting for quiet hours to end. flush=true sends them now (one digest); drop_id drops one.',
    { flush: z.boolean().optional(), drop_id: z.number().int().optional() },
    async (a) => {
      if (a.drop_id !== undefined) { pc.heldDrop(a.drop_id); logAction(source, 'push_drop', String(a.drop_id)); }
      if (a.flush) { const r = await pc.heldFlush(); logAction(source, 'push_flush', ''); return { ...r, ...pc.heldItems() }; }
      return pc.heldItems();
    });
  reg('push_test', 'Send a test push now, past quiet hours and switches. Returns sent or failed.', {},
    async () => { const r = await pc.testPush(); logAction(source, 'push_test', r.status); return r; });
  reg('status', 'System health: overall level and each check with its fix.', {}, () => storedStatus());

  registerModuleTools(reg, source);

  // ---------- Community plugins (`<plugin>_<tool>`, loaded from MOSAIC_PLUGINS_DIR at startup) ----------
  for (const t of pluginTools()) {
    reg(t.name, t.description, t.shape, async (a) => {
      const r = await t.run(a);
      logAction(source, t.name, '');
      return r;
    });
  }

  return s;
};

export const isDateArg = isDate;
