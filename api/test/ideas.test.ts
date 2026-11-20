import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-ideas-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_TZ = 'UTC';
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });

const ideas = await import('../src/modules/ideas/store.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const timer = await import('../src/timer.ts');
const { kvSet } = await import('../src/db.ts');
const { run } = await import('../src/modules/util.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('questions: add, dedupe, answer', async () => {
  const q = ideas.addQuestion('Why do onions make you cry?');
  assert.equal(q.status, 'open');
  const d = ideas.addQuestion('why do ONIONS make you cry');
  assert.equal(d.id, q.id);
  assert.equal(d.duplicate, true);
  assert.equal(code(() => ideas.addQuestion('hi')), 'bad_request');
  assert.equal(ideas.openQuestions().length, 1);
  const a = await ideas.answerQuestion(q.id, 'Sulfur compounds irritate the eyes.');
  assert.equal(a.status, 'answered');
  assert.equal(ideas.openQuestions().length, 0);
  assert.equal(code(() => ideas.updateQuestion(q.id, { status: 'answered' })), 'bad_request');
  assert.equal(ideas.updateQuestion(q.id, { status: 'dropped' }).status, 'dropped');
});

test('similar tasks: jaccard on 3+ tokens', () => {
  const a = tasks.addTask({ title: 'Renew passport photo booking' });
  const b = tasks.addTask({ title: 'Book passport photo renewal' });
  assert.deepEqual(ideas.similarTasks('Renew passport photo booking', 'x').map((r) => r.id).includes(a.id), true);
  assert.equal(ideas.similarTasks('Buy milk', 'x').length, 0); // under 3 tokens
  const m = ideas.mergeTasks(a.id, b.id);
  assert.equal(m!.id, a.id);
  assert.equal(tasks.getTask(b.id)!.status, 'dropped');
  assert.equal(code(() => ideas.mergeTasks(a.id, a.id)), 'bad_request');
});

test('compost moves only old untouched inbox items', () => {
  const old = tasks.addTask({ title: 'Old inbox thought' });
  const pinned = tasks.addTask({ title: 'Old pinned', pinned: true });
  const fresh = tasks.addTask({ title: 'Fresh inbox thought' });
  const past = new Date(Date.now() - 40 * 86400000).toISOString();
  run(`UPDATE tasks SET updated_at = ? WHERE id IN (?, ?)`, past, old.id, pinned.id);
  const dry = ideas.compost(new Date(), 30, true);
  assert.equal(dry.moved, 1);
  assert.equal(tasks.getTask(old.id)!.someday, false);
  const r = ideas.compost();
  assert.equal(r.moved, 1);
  const t = tasks.getTask(old.id)!;
  assert.equal(t.someday, true);
  assert.ok(t.tags.includes('composted'));
  assert.equal(tasks.getTask(fresh.id)!.someday, false);
  assert.equal(tasks.getTask(pinned.id)!.someday, false);
  assert.ok(ideas.composted().some((x) => x.id === old.id));
  const back = ideas.restoreComposted(old.id);
  assert.equal(back.someday, false);
  assert.ok(!back.tags.includes('composted'));
});

test('triage: one Inbox move a day unless urgent', () => {
  const day = '2026-11-11';
  const a = tasks.addTask({ title: 'Triage A' });
  const b = tasks.addTask({ title: 'Triage B' });
  const c = tasks.addTask({ title: 'Triage C' });
  const t = ideas.triage(day);
  assert.ok(t.items.length > 0 && t.items.length <= 5);
  assert.equal(ideas.triageDecide(a.id, 'project', { project: 'Personal' }, day).action, 'project');
  assert.equal(code(() => ideas.triageDecide(b.id, 'project', { project: 'Personal' }, day)), 'conflict');
  assert.equal(ideas.triageDecide(b.id, 'project', { project: 'Personal', urgent: true }, day).action, 'project');
  assert.equal(ideas.triageDecide(c.id, 'someday', {}, day).task!.someday, true);
  assert.equal(ideas.triage(day).promoted_today.id, a.id);
  assert.equal(code(() => ideas.triageDecide(c.id, 'bogus' as never, {}, day)), 'bad_request');
});

test('fits: nothing in Zero mode or Saturday, fits before an anchor otherwise', () => {
  tasks.addTask({ title: 'Quick 10 min thing', est_minutes: 10 });
  tasks.addTask({ title: 'Long 200 min thing', est_minutes: 200 });
  const at = new Date('2026-11-11T11:00:00Z'); // Wed, after wake, well before lunch
  kvSet('mode', 'Zero');
  assert.equal(ideas.fits(at).tasks.length, 0);
  kvSet('mode', 'Normal');
  const sat = ideas.fits(new Date('2026-11-14T11:00:00Z'));
  assert.equal(sat.reason, 'Saturday');
  const f = ideas.fits(at);
  assert.equal(f.reason, null);
  assert.ok(f.tasks.every((t) => (t.est_minutes ?? 0) <= f.gap_min! - 3));
  assert.ok(f.tasks.some((t) => t.title === 'Quick 10 min thing'));
  assert.ok(!f.tasks.some((t) => t.title === 'Long 200 min thing'));
  assert.equal(ideas.fits(new Date('2026-11-11T03:30:00Z')).reason, 'rest hours');
  assert.equal(ideas.fits(new Date('2026-11-11T23:10:00Z')).tasks.length, 0);
});

test('timer pause and resume push the end later', async () => {
  const t = timer.startTimer(25, 'Focus');
  assert.equal(code(() => timer.pauseTimer('nap')), 'bad_request');
  const p = timer.pauseTimer('family');
  assert.ok(p.pausedAt);
  assert.equal(p.pauseReason, 'family');
  await new Promise((r) => setTimeout(r, 30));
  const r = timer.resumeTimer();
  assert.equal(r.pausedAt, null);
  assert.ok(Date.parse(r.endsAt) >= Date.parse(t.endsAt));
  assert.ok((r.pausedMs ?? 0) >= 0);
  timer.stopTimer();
  assert.equal(timer.getTimer(), null);
  assert.equal(code(() => timer.pauseTimer()), 'not_found');
});

test('focus log keeps pause and estimates skip long pauses', () => {
  const t = tasks.addTask({ title: 'Estimate me', est_minutes: 20 });
  const row = tasks.logFocus(t.id, 30, undefined, undefined, 15 * 60000, 'family');
  assert.equal(row.paused_ms, 900000);
  assert.equal(row.pause_reason, 'family');
});
