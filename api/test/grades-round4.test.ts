import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-grades4-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const g = await import('../src/modules/grades/store.ts');
const { all, one, run } = await import('../src/modules/util.ts');
const { kvSet } = await import('../src/db.ts');
const TODAY = '2026-11-11'; // Wednesday
const SUNDAY = '2026-11-15';
const MONDAY = '2026-11-16';

let goalId = '';
test('floor pace gives B, shrink makes the floor the target', () => {
  const goal = g.createGoal({ name: 'Read 100 books', target_value: 100, unit: 'books', start_value: 0, start_day: '2026-01-01', target_date: '2026-12-31' }, TODAY);
  goalId = String(goal.id);
  one(`SELECT 1 AS x`); // db ready
  const { setGoalValue } = { setGoalValue: (v: number) => { run(`INSERT INTO goal_values (goal_id, day, value) VALUES (?, ?, ?) ON CONFLICT (goal_id, day) DO UPDATE SET value = excluded.value`, goalId, TODAY, v); } };
  setGoalValue(50);
  const v = g.goalView(g.findGoal(goalId), TODAY);
  assert.equal(v.floor, 50);
  assert.equal(v.letter, 'B');
  const s = g.shrinkGoal(goalId, TODAY);
  assert.equal(s.target_value, 50);
  assert.equal(s.letter, 'A'); // reached its new target
  assert.throws(() => g.shrinkGoal(goalId, TODAY));
});

test('stretch line is reported', () => {
  const goal = g.createGoal({ name: 'Walk km', target_value: 10, stretch_value: 12, start_value: 0, start_day: '2026-11-01', target_date: '2026-12-31' }, TODAY);
  run(`INSERT INTO goal_values (goal_id, day, value) VALUES (?, ?, ?)`, String(goal.id), TODAY, 1);
  const v = g.goalView(g.findGoal(String(goal.id)), TODAY);
  assert.equal(v.stretch_value, 12);
  assert.equal(v.stretch_note, null);
});

test('confidence ask only on fresh-start days (Monday, 1st), once', () => {
  assert.equal(g.ensureConfidenceAsk(TODAY), null);
  assert.equal(g.ensureConfidenceAsk(SUNDAY), null);
  assert.equal(g.isFreshStart('2026-12-01'), true);
  const k = g.ensureConfidenceAsk(MONDAY);
  assert.equal(k, 'goals.confidence.w20261116');
  assert.equal(g.ensureConfidenceAsk(MONDAY), k);
  assert.equal(all(`SELECT 1 AS x FROM asks WHERE key LIKE 'goals.confidence.%'`).length, 1);
  assert.equal(all(`SELECT 1 AS x FROM goal_confidence`).length, 1);
});

test('rating tags round-trip; unknown tags rejected', () => {
  g.setDayRating(4, TODAY, 'ok', ['gym', 'outside']);
  const r = g.getDayRating(TODAY) as { tags: string[] | string };
  const tags = Array.isArray(r.tags) ? r.tags : JSON.parse(String(r.tags));
  assert.deepEqual([...tags].sort(), ['gym', 'outside']);
  assert.throws(() => g.setDayRating(3, TODAY, '', ['made_up']));
});

test('patterns need 40 days', () => {
  const p = g.ratingPatterns(TODAY);
  assert.equal(p.line, 'Not enough days yet.');
  assert.equal(p.patterns.length, 0);
});

test('quiet areas are hidden outside Normal mode; dismiss lasts 28 days', () => {
  kvSet('mode', 'Zero');
  assert.deepEqual(g.quietAreas(TODAY).areas, []);
  kvSet('mode', 'Normal');
  const d = g.dismissQuiet('body', TODAY);
  assert.equal(d.until, '2026-12-09');
  assert.ok(!g.quietAreas(TODAY).areas.some((a) => a.key === 'body'));
});

test('what-if rejects non-savings goals', () => {
  assert.throws(() => g.goalWhatIf(goalId, 5000, TODAY), /savings/);
});

test('quarter report writes to the vault without the work area', () => {
  const r = g.quarterReport(TODAY, true);
  assert.equal(r.path, 'Reviews/2026-Q4.md');
  const abs = join(root, 'vault', 'Reviews', '2026-Q4.md');
  assert.ok(existsSync(abs));
  const txt = readFileSync(abs, 'utf8');
  assert.match(txt, /# 2026-Q4 review/);
  const header = txt.split('\n').find((l) => l.startsWith('| Week'))!;
  assert.ok(!/\bWork\b/.test(header));
  const dry = g.quarterReport(TODAY, false);
  assert.equal(dry.content.length > 0, true);
});
