import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-grades-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const g = await import('../src/modules/grades/store.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const { run, uuid } = await import('../src/modules/util.ts');
const { addDays, weekStartOf } = await import('../src/time.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code ?? e.message; } };
const BANNED = /streak|points?\b|missed|overdue|failed|behind|lazy|should have|\bF\b/;
const text = (x: unknown) => JSON.stringify(x);

// A fixed past week: Monday 2026-11-02 .. Sunday 2026-11-08 (Saturday 07 = rest).
const WS = '2026-11-02';
const AFTER = '2026-11-10';

test('letters: A/B/C/D thresholds, never F', () => {
  assert.equal(g.letterOf(0.9), 'A');
  assert.equal(g.letterOf(0.7), 'B');
  assert.equal(g.letterOf(0.5), 'C');
  assert.equal(g.letterOf(0), 'D');
  assert.equal(g.letterOf(null), null);
  assert.ok(!g.LETTERS.some((l) => String(l.letter) === 'F'));
});

test('default areas are seeded once and idempotent', () => {
  const a = g.listAreas().filter((x) => x.key);
  const b = g.listAreas().filter((x) => x.key);
  assert.ok(a.length >= 6);
  assert.equal(a.length, b.length);
  assert.ok(a.some((x) => x.key === 'body'));
});

test('empty week: nothing graded, neutral line', () => {
  const w = g.gradesWeek(WS, AFTER);
  assert.equal(w.overall.letter, null);
  assert.ok(w.areas.every((x) => x.status !== 'graded'));
  assert.doesNotMatch(text(w), BANNED);
});

test('habit checks grade an area; Saturday excluded from active days; lift line', () => {
  const h = tasks.addHabit('Read 10 pages', 6) as any;
  run(`UPDATE habits SET area_id = (SELECT id FROM areas WHERE key = 'learning') WHERE id = ?`, h.id);
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) tasks.checkHabit(h.id, d);
  const w = g.gradesWeek(WS, AFTER);
  assert.equal(w.active_days, 6);
  const learn = w.areas.find((x) => x.key === 'learning')!;
  assert.equal(learn.status, 'graded');
  assert.equal(learn.letter, 'C'); // 3/6 = 0.5
  assert.match(String(learn.lift), /more/);
  assert.doesNotMatch(text(w), BANNED);
});

test('light week: under 3 active days is not graded', () => {
  // Week of 2026-11-09 viewed on Tuesday 10th: Mon + Tue = 2 active days.
  const w = g.gradesWeek('2026-11-09', '2026-11-10');
  assert.equal(w.light_week, true);
  assert.equal(w.overall.letter, null);
  assert.ok(w.so_far);
});

test('future week rejected, bad week rejected', () => {
  assert.equal(code(() => g.gradesWeek('2027-01-04', AFTER)), 'bad_request');
  assert.equal(code(() => g.gradesWeek('nope', AFTER)), 'bad_request');
});

test('grade target override changes the letter', () => {
  g.setGradeTarget('learning', [...g.gradesWeek(WS, AFTER).areas.find((x) => x.key === 'learning')!.facts][0].key, 3);
  const learn = g.gradesWeek(WS, AFTER).areas.find((x) => x.key === 'learning')!;
  assert.equal(learn.letter, 'A');
  assert.equal(code(() => g.setGradeTarget('learning', 'x', 0)), 'bad_request');
});

test('history: snapshots stored, oldest first', () => {
  const h = g.gradesHistory(3, AFTER);
  assert.equal(h.length, 3);
  assert.equal(h[2].week_start, weekStartOf(AFTER));
  assert.equal(h[1].week_start, WS);
  assert.equal(h[1].areas.learning, 'A');
});

test('day rating: 1-5 only, upsert, clear, no future', () => {
  g.setDayRating(4, '2026-11-03', 'good');
  g.setDayRating(5, '2026-11-03');
  assert.equal((g.getDayRating('2026-11-03') as any).rating, 5);
  assert.equal(code(() => g.setDayRating(6, '2026-11-03')), 'bad_request');
  assert.equal(code(() => g.setDayRating(3, addDays(AFTER, 400))), 'bad_request');
  assert.equal(g.gradesWeek(WS, AFTER).day_rating_avg, 5);
  g.clearDayRating('2026-11-03');
  assert.equal((g.getDayRating('2026-11-03') as any)?.rating ?? null, null);
});

test('goals: create with seed_key is idempotent, pace + letter, no contact data', () => {
  const a = g.createGoal({ name: 'Savings test', target_value: 100, unit: 'USD', start_value: 0, start_day: '2026-11-01', target_date: '2026-12-31', seed_key: 't1', area: 'money' }, AFTER);
  const b = g.createGoal({ name: 'Savings test again', seed_key: 't1' }, AFTER);
  assert.equal(a.id, b.id);
  // #48: work goals are allowed; contact details are not.
  assert.equal(code(() => g.createGoal({ name: 'Finish 10 chapters', target_value: 10, target_date: '2026-12-31' }, AFTER)), 'ok');
  assert.equal(code(() => g.createGoal({ name: 'Call +1 918 555 0142' }, AFTER)), 'bad_request');
  assert.equal(code(() => g.createGoal({ name: 'Email bob@example.com' }, AFTER)), 'bad_request');
  const tree = g.goalsTree(AFTER);
  assert.ok(tree.count >= 1);
  assert.doesNotMatch(text(tree), BANNED);
});

test('goals: pause shifts the target date on resume; finish/reopen', () => {
  const x = g.createGoal({ name: 'Pause me', target_value: 10, target_date: '2026-12-31', start_day: '2026-11-01' }, AFTER);
  g.pauseGoal(x.id);
  run(`UPDATE goals SET paused_at = ? WHERE id = ?`, '2026-11-01', x.id);
  const r = g.resumeGoal(x.id, AFTER) as any;
  assert.ok(r.target_date > '2026-12-31');
  assert.equal((g.finishGoal(x.id, 'done') as any).status, 'done');
  assert.equal((g.reopenGoal(x.id) as any).status, 'active');
});

test('milestones: add, done gives a moment line, auto=milestones progress', () => {
  const x = g.createGoal({ name: 'Ship the garden plan', auto: 'milestones' }, AFTER);
  const m1 = g.addMilestone(x.id, 'Sketch the beds') as any;
  g.addMilestone(x.id, 'Buy the seeds');
  const d = g.milestoneDone(m1.id) as any;
  assert.ok(typeof d.moment === 'string');
  const v = g.goalView(g.findGoal(x.id), AFTER);
  assert.equal(v.progress, 0.5);
});

test('templates: unknown key rejected, cards reads card reviews', () => {
  assert.equal(code(() => g.goalFromTemplate('nope', {}, AFTER)), 'bad_request');
  run(`INSERT INTO card_reviews (id, card_id, grade, at) VALUES (?, ?, ?, ?)`, uuid(), 'c1', 3, `${AFTER}T12:00:00Z`);
  const j = g.goalFromTemplate('cards', { start_day: '2026-11-01' }, AFTER) as any;
  assert.ok(j.id);
  assert.ok(Number(g.goalView(g.findGoal(j.id), AFTER).current) >= 1);
});

test('bad auto rejected', () => {
  assert.equal(code(() => g.createGoal({ name: 'Weird', auto: 'rocket:fuel' }, AFTER)), 'bad_request');
});

test('gradesDaily runs without throwing and stores this week', () => {
  g.gradesDaily(AFTER);
  const h = g.gradesHistory(1, AFTER);
  assert.equal(h[0].week_start, weekStartOf(AFTER));
});
