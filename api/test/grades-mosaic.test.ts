import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic--grades-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const g = await import('../src/modules/grades/store.ts');
const { run, insert, uuid, one } = await import('../src/modules/util.ts');
const { lifeToday } = await import('../src/time.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code ?? e.message; } };
const BANNED = /streak|missed|overdue|failed|behind|lazy|should have|\bgrade\b/i;

// Fixed past week: Monday 2026-11-02 .. Sunday 2026-11-08.
const WS = '2026-11-02';
const TODAY = '2026-11-10';

const project = (name: string) => {
  const id = uuid();
  insert('projects', { id, name });
  return id;
};
/** Done task at a UTC wall time. */
const doneTask = (title: string, projectId: string | null, day: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h, m));
  insert('tasks', { id: uuid(), title, project_id: projectId, status: 'done', done_at: utc.toISOString() });
};

test('migration v24: review_changes exists', () => {
  assert.ok(one(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_changes'`));
});

test('titleCount: first plain count, not a duration, time or percent', () => {
  assert.equal(g.titleCount('Read 10 pages: chapter 2'), 10);
  assert.equal(g.titleCount('Stretch 25 min then 6 push-ups'), 6);
  assert.equal(g.titleCount('At 15:30 write 8 notes'), 8);
  assert.equal(g.titleCount('Raise focus 20% with 12 cards'), 12);
  assert.equal(g.titleCount('Read pages'), null);
  assert.equal(g.titleCount('Write 5000 words'), null);
});

test('done-log: entries per day and month totals line', () => {
  const personal = project('Personal');
  doneTask('Read 10 pages', personal, '2026-11-03', '15:50');
  doneTask('Fix the bike light', personal, '2026-11-03', '09:10');
  doneTask('Clean 3 folders', null, '2026-11-04', '12:00');
  insert('workouts', { id: uuid(), name: 'Push', started_at: '2026-11-05T18:30:00Z', status: 'done', day: '2026-11-05' });
  const w = g.doneLog('week', '2026-11-08');
  assert.equal(w.from, WS);
  assert.equal(w.to, '2026-11-08');
  const lines = w.entries.map((e) => e.line);
  assert.ok(lines.includes('Tue · Read 10 pages (Personal)'));
  assert.ok(lines.includes('Wed · Clean 3 folders'));
  assert.ok(lines.includes('Thu · Gym: Push'));
  assert.equal(w.totals.gym, 1);
  assert.equal(w.totals.tasks, 3);
  const m = g.doneLog('month', '2026-11-08');
  assert.equal(m.from, '2026-11-01');
  assert.match(m.month_line, /^This month: 3 tasks done, 1 gym session/);
  assert.equal(g.doneLog('day', '2026-11-03').entries.length, 2);
  assert.equal(code(() => g.doneLog('year' as any, TODAY)), 'bad_request');
  assert.equal(g.totalsLine('This month', { tasks: 0, gym: 0, food_days: 0, habits: 0, cards: 0, money_saved_usd: 0 }), 'This month: nothing logged yet.');
});

test('week: 3 facts + 1 change, day ratings as an array, no letters in the text', () => {
  g.setDayRating(4, '2026-11-03');
  g.setDayRating(2, '2026-11-05');
  const w = g.gradesWeek(WS, TODAY);
  assert.ok(Array.isArray(w.day_ratings));
  assert.deepEqual(w.day_ratings, [{ day: '2026-11-03', rating: 4 }, { day: '2026-11-05', rating: 2 }]);
  assert.equal(w.day_rating_count, 2);
  assert.ok(w.facts.length <= 3);
  assert.doesNotMatch(w.line, /\b[A-D]\b/);
  assert.doesNotMatch(JSON.stringify({ line: w.line, facts: w.facts, change: w.change }), BANNED);
  if (w.change) {
    assert.equal(w.change.accepted, false);
    const acc = g.setWeekChange(WS, undefined, TODAY)!;
    assert.equal(acc.accepted, true);
    assert.equal(acc.edited, false);
  }
  const own = g.setWeekChange(WS, 'Gym right after dinner on Mon/Wed/Fri', TODAY)!;
  assert.equal(own.text, 'Gym right after dinner on Mon/Wed/Fri');
  assert.equal(own.edited, true);
  assert.equal(g.gradesWeek(WS, TODAY).change!.text, own.text);
  assert.equal(code(() => g.setWeekChange('nope', 'x', TODAY)), 'bad_request');
});

test('resume keeps start_day; repace changes only the date', () => {
  const x = g.createGoal({ name: 'Read 300 pages', target_value: 300, start_value: 0, start_day: '2026-10-01', target_date: '2026-12-31' }, TODAY);
  g.pauseGoal(x.id);
  run(`UPDATE goals SET paused_at = ? WHERE id = ?`, '2026-11-01', x.id);
  const r = g.resumeGoal(x.id, TODAY) as any;
  assert.equal(r.start_day, '2026-10-01');
  assert.equal(r.target_date, '2027-01-09');
  const before = g.goalDetail(x.id, TODAY) as any;
  const p = g.repaceGoal(x.id, TODAY, '2027-03-01') as any;
  assert.equal(p.target_date, '2027-03-01');
  assert.equal(p.start_day, before.start_day);
  assert.equal(p.start_value, before.start_value);
  assert.equal(p.target_value, before.target_value);
});

test('templates: ship a side project, read 12 books, run a 10k', () => {
  const keys = g.GOAL_TEMPLATES.map((t: any) => t.key);
  assert.ok(keys.includes('side_project'));
  assert.ok(keys.includes('read_books'));
  const a = g.goalFromTemplate('side_project', {}, TODAY) as any;
  const b = g.goalFromTemplate('side_project', {}, TODAY) as any;
  assert.equal(a.id, b.id);
  assert.equal(a.milestones.length, 4);
  const r = g.goalFromTemplate('run_10k', {}, TODAY) as any;
  assert.equal(r.milestones.length, 4);
  const m = g.goalFromTemplate('read_books', {}, TODAY) as any;
  assert.equal(Number(m.target_value), 12);
});

test('next step: one verb-first task under 45 chars per area, avoid window from profile', () => {
  assert.equal(g.trim45('Read 10 pages'), 'Read 10 pages');
  const long = g.trim45('Finish the garden plan sketch and the shopping list for the weekend today');
  assert.ok(long.length <= 45);
  assert.ok(long.endsWith('…'));
  const n = g.goalsNextStep(TODAY);
  assert.equal(n.day, TODAY);
  assert.ok(n.steps.length >= 1);
  for (const s of n.steps) {
    assert.ok(String(s.task).length < 45, s.task);
    assert.ok(Number(s.est_minutes) > 0);
  }
  const areas = n.steps.map((s) => s.area);
  assert.equal(new Set(areas).size, areas.length);
  assert.ok(lifeToday());
});
