import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-claude-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_TZ = 'UTC';
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');

const c = await import('../src/claude.ts');
const { getDb } = await import('../src/db.ts');
const L = (o: unknown) => JSON.stringify(o) + '\n';

test('parser: session, deltas, tools, result; partial lines and junk', () => {
  const s = c.newParserState();
  const stream =
    L({ type: 'system', subtype: 'init', session_id: 'S1' }) +
    'not json at all\n' +
    L({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }) +
    L({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }) +
    L({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } }) +
    L({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', name: 'mcp__mosaic__set_block_task', input: { task: 'Draft 3 pages' } }] } }) +
    L({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } }) +
    L({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 'S1' });
  const out: unknown[] = [];
  for (let i = 0; i < stream.length; i += 7) out.push(...c.parseChunk(stream.slice(i, i + 7), s)); // awkward chunks
  out.push(...c.flushParser(s));
  assert.deepEqual(out, [
    { type: 'session', sessionId: 'S1' },
    { type: 'raw', line: 'not json at all' },
    { type: 'text', text: 'Hel' },
    { type: 'text', text: 'lo' },
    { type: 'tool', name: 'set_block_task', summary: 'Updated Draft 3 pages' },
    { type: 'text', text: 'Done.' },
    { type: 'result', isError: false, text: 'Done.', sessionId: 'S1' },
  ]);
});

test('tool summary fallback', () => {
  assert.equal(c.toolSummary('weird_tool', {}), 'Ran weird_tool');
  assert.equal(c.toolSummary('Read', { file_path: '/a/b/CLAUDE.md' }), 'Read CLAUDE.md');
});

test('usage limit detection', () => {
  assert.deepEqual(c.detectLimit('all good'), { limited: false, resetAt: null });
  const e = c.detectLimit('Claude AI usage limit reached|1762880400');
  assert.equal(e.limited, true);
  assert.equal(Date.parse(e.resetAt!), 1762880400 * 1000);
  assert.match(e.resetAt!, /(?:[+-]\d{2}:\d{2}|Z)$/);
  assert.equal(c.detectLimit('5-hour limit reached ∙ resets 3pm').resetAt, '3pm');
  assert.equal(c.detectLimit('Usage limit reached, resets at 2026-11-12T03:00:00Z').resetAt, '2026-11-12T03:00:00Z');
  assert.equal(c.detectLimit('rate limit hit').resetAt, null);
  assert.equal(c.isAuthError('Invalid API key · Please run /login'), true);
});

test('lock: stale rows are cleared, live rows block', () => {
  const db = getDb();
  const ins = db.prepare('INSERT OR REPLACE INTO claude_lock (id, run_id, label, pid, started_at) VALUES (1, ?, ?, ?, ?)');
  ins.run('x', 'old', 999999, new Date().toISOString());
  assert.deepEqual(c.claudeBusy(), { busy: false, label: null });
  ins.run('y', 'Nightly plan', process.pid, new Date().toISOString());
  assert.deepEqual(c.claudeBusy(), { busy: true, label: 'Nightly plan' });
  assert.throws(() => c.startRun({ prompt: '/what-now' }), (e: any) => e.code === 'conflict' && e.extra.busy === 'Nightly plan');
  db.prepare('DELETE FROM claude_lock').run();
});

test('missing CLI ends the run with an error and frees the lock', async () => {
  process.env.CLAUDE_BIN = join(root, 'no-such-claude');
  const { runId, chatId } = c.startRun({ prompt: 'hello there' });
  const done: any = await new Promise((r) => c.subscribe(runId, (e) => { if (e.event === 'done') r(e.data); }));
  assert.equal(done.chatId, chatId);
  assert.ok(done.error);
  assert.equal(c.claudeBusy().busy, false);
  const chat = c.getChat(chatId);
  assert.equal(chat.title, 'hello there');
  assert.deepEqual(chat.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(c.listChats()[0].id, chatId);
});

test('chat title: a voice chat is titled from the first spoken words', () => {
  assert.equal(c.chatTitle('[Voice mode. Reply in one to three short spoken sentences.]\nWhat is   next today?'), 'What is next today?');
  assert.equal(c.chatTitle('/plan-tomorrow'), '/plan-tomorrow');
  assert.equal(c.chatTitle('[Voice mode. Short.]'), 'Voice chat');
  assert.equal(c.chatTitle('x'.repeat(80)).length, 60);
});
