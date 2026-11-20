import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-habitat-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const h = await import('../src/modules/habitat/store.ts');
const money = await import('../src/modules/money/store.ts');
const gym = await import('../src/modules/gym/store.ts');
const food = await import('../src/modules/food/store.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const { run, one, uuid } = await import('../src/modules/util.ts');
const { lifeToday, addDays, weekStartOf } = await import('../src/time.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

const BANNED = /streak|points?\b|missed|overdue|failed|behind|lazy|should have/i;
const text = (x: unknown) => JSON.stringify(x);

test('possibleDouble: money within 15 min is caught, far apart is not, keepBoth silences it', () => {
  const acct = money.addAccount({ name: 'Wallet', currency: 'USD' });
  const day = lifeToday();
  const a = money.addRecord({ account: acct.id, amount: 12, category: 'Food', at: `${day}T13:00:00Z`, day });
  const b = money.addRecord({ account: acct.id, amount: 12, category: 'Food', at: `${day}T13:06:00Z`, day });
  const c = money.addRecord({ account: acct.id, amount: 12, category: 'Food', at: `${day}T15:00:00Z`, day });
  const hit = h.possibleDouble('money', { id: b.id });
  assert.equal(hit?.id, a.id);
  assert.equal(hit?.gap_s, 360);
  assert.equal(hit?.at_hhmm, '13:00');
  assert.equal(h.possibleDouble('money', { id: c.id }), null);
  // a different amount is not a double
  const d = money.addRecord({ account: acct.id, amount: 30, category: 'Food', at: `${day}T13:02:00Z`, day });
  assert.equal(h.possibleDouble('money', { id: d.id }), null);
  // unsaved candidate row
  assert.equal(h.possibleDouble('money', { kind: 'expense', amount: 12, category_id: a.category_id, day, at: `${day}T13:10:00Z` })?.id, b.id);
  h.keepBoth(b.id, a.id);
  assert.equal(h.possibleDouble('money', { id: b.id }), null);
  assert.equal(code(() => h.possibleDouble('nope' as never, {})), 'bad_request');
});

test('possibleDouble: food, water, set', () => {
  const day = lifeToday();
  const f1 = food.logFood({ name: 'Coffee', kcal: 5, at: `${day}T11:00:00Z`, day });
  const f2 = food.logFood({ name: 'coffee', kcal: 5, at: `${day}T11:10:00Z`, day });
  assert.equal(h.possibleDouble('food', { id: (f2 as any).id })?.id, (f1 as any).id);
  const w1 = uuid(), w2 = uuid();
  food.addWater(250, day, w1);
  food.addWater(250, day, w2);
  assert.equal(h.possibleDouble('water', { id: w2 })?.id, w1);

  gym.addExercise({ name: 'Bench' });
  const w = gym.startWorkout({});
  const t0 = Date.now() - 60000;
  const s1 = gym.logSet({ workout_id: w.id as string, exercise: 'Bench', weight: 60, reps: 8, at: new Date(t0).toISOString() }) as any;
  const s2 = gym.logSet({ workout_id: w.id as string, exercise: 'Bench', weight: 60, reps: 8, at: new Date(t0 + 5000).toISOString() }) as any;
  const s3 = gym.logSet({ workout_id: w.id as string, exercise: 'Bench', weight: 60, reps: 8, at: new Date(t0 + 120000).toISOString() }) as any;
  const id = (s: any) => s.set?.id ?? s.id;
  assert.equal(h.possibleDouble('set', { id: id(s2) })?.id, id(s1));
  assert.equal(h.possibleDouble('set', { id: id(s3) }), null); // a real next set after rest
  gym.finishWorkout(w.id as string);
});

test('undo shelf lists removed rows and restores by whitelist', () => {
  const t = tasks.addTask({ title: 'Call the plumber' });
  const kid = tasks.addTask({ title: 'Find number', parent_id: t.id } as any);
  tasks.deleteTask(t.id);
  const acct = money.addAccount({ name: 'Cash', currency: 'USD' });
  const r = money.addRecord({ account: acct.id, amount: 7, note: 'bread' });
  money.deleteRecord(r.id);
  const shelf = h.recentlyRemoved();
  assert.ok(shelf.some((x) => x.table === 'tasks' && x.id === t.id && x.label === 'Call the plumber'));
  assert.ok(!shelf.some((x) => x.id === kid.id), 'subtask is restored with its parent, not listed alone');
  assert.ok(shelf.some((x) => x.table === 'records' && x.label.includes('bread')));
  assert.deepEqual(h.restoreRemoved('tasks', t.id), { table: 'tasks', id: t.id, restored: true });
  assert.equal(one<any>('SELECT deleted_at FROM tasks WHERE id = ?', kid.id).deleted_at, null);
  assert.equal(h.restoreRemoved('records', r.id).restored, true);
  assert.equal(h.restoreRemoved('records', r.id).restored, false);
  assert.equal(code(() => h.restoreRemoved('accounts', acct.id)), 'bad_request');
  assert.equal(code(() => h.restoreRemoved('tasks', uuid())), 'not_found');
  assert.equal(code(() => h.recentlyRemoved(0)), 'bad_request');
});

test('last-done board: stamp creates, sorted by name, rename conflict, delete', () => {
  const day = lifeToday();
  const a = h.stampLastDone('Water the plants', addDays(day, -3));
  h.stampLastDone('car oil');
  h.addLastDone('Barber');
  const board = h.lastDoneBoard(day);
  assert.deepEqual(board.map((x) => x.name), ['Barber', 'car oil', 'Water the plants']);
  assert.equal(board[0].last_at, null);
  assert.equal(board[0].days_since, null);
  assert.equal(board[2].days_since, 3);
  const again = h.stampLastDone('water the PLANTS');
  assert.equal(again.id, a.id);
  assert.equal(again.days_since, 0);
  assert.equal(code(() => h.renameLastDone(a.id, 'barber')), 'conflict');
  assert.equal(h.renameLastDone(a.id, 'Plants').name, 'Plants');
  const cid = uuid();
  assert.equal(h.addLastDone('Sheets', { id: cid }).id, cid);
  assert.equal(h.deleteLastDone(cid).deleted, true);
  assert.equal(code(() => h.deleteLastDone(cid)), 'not_found');
  assert.equal(code(() => h.stampLastDone('x', '2999-01-01T00:00:00Z')), 'bad_request');
  assert.ok(!BANNED.test(text(h.lastDoneBoard())));
});

test('freeToSpend: null without budget, then estimate with planned payments', () => {
  const day = lifeToday();
  const none = h.freeToSpend(day) as any;
  assert.equal(none.free, null);
  assert.match(none.reason, /no weekly budget/);
  money.addBudget({ name: 'Week', period: 'week', amount_usd: 1000 });
  const acct = money.addAccount({ name: 'Main', currency: 'USD' });
  const ws = weekStartOf(day);
  money.addRecord({ account: acct.id, amount: 30, day: ws, at: `${ws}T12:00:00Z` });
  money.addPlanned({ name: 'Phone', template: { amount: 10, account: acct.id }, recur: { freq: 'monthly', interval: 1 } as any, next_due: addDays(ws, 6) });
  money.addPlanned({ name: 'Later', template: { amount: 99, account: acct.id }, recur: { freq: 'monthly', interval: 1 } as any, next_due: addDays(ws, 20) });
  const f = h.freeToSpend(day) as any;
  assert.equal(f.estimate, true);
  assert.equal(f.source, 'week');
  assert.equal(f.planned_usd, 10);
  assert.ok(f.used_usd >= 30);
  assert.equal(f.free_usd, Math.round((1000 - 10 - f.used_usd) * 100) / 100);
  assert.ok(f.free_usd > 0);
  assert.match(f.line, /\$/);
  assert.ok(!BANNED.test(text(f)));
  assert.ok(!/over budget|overspent/i.test(text(f)));
  assert.equal(code(() => h.freeToSpend('nope')), 'bad_request');
});

test('lent things: add, list, return, money is pointed to Debts', () => {
  const id = uuid();
  const l = h.addLent({ id, thing: 'Drill', person: 'Karim', direction: 'lent' });
  assert.equal(l.id, id);
  h.addLent({ thing: 'Book: Atomic Habits', person: 'Amine', direction: 'borrowed', back_by: addDays(lifeToday(), 10) });
  assert.equal(h.listLent().length, 2);
  assert.equal(h.listLent({ direction: 'borrowed' }).length, 1);
  assert.ok(h.returnLent(id).returned_at);
  assert.equal(h.listLent().length, 1);
  assert.equal(h.listLent({ open: false }).length, 2);
  assert.equal(code(() => h.addLent({ thing: '50 USD', person: 'X', direction: 'lent' })), 'bad_request');
  assert.equal(code(() => h.addLent({ thing: 'Pen', person: 'X', direction: 'given' as never })), 'bad_request');
});

test('closedDays: national holidays and weekend', () => {
  const nov = h.closedDays('2026-11-01', '2026-11-07');
  const first = nov.find((d) => d.day === '2026-11-01')!;
  assert.ok(first.reasons.some((r) => r.kind === 'national' && r.name === 'Revolution Day'));
  assert.ok(nov.find((d) => d.day === '2026-11-06')!.reasons.some((r) => r.kind === 'weekly')); // Friday
  assert.ok(!nov.some((d) => d.day === '2026-11-04')); // Wednesday, open
  const jan = h.closedDays('2027-01-01', '2027-01-12');
  assert.ok(jan.find((d) => d.day === '2027-01-12')!.reasons.some((r) => r.name === 'Yennayer'));
  assert.equal(code(() => h.closedDays('2026-01-01', '2028-01-01')), 'bad_request');
  assert.equal(code(() => h.closedDays('2026-02-01', '2026-01-01')), 'bad_request');
});

test('leaveBy', () => {
  const l = h.leaveBy('2026-11-12T10:00:00Z', 25);
  assert.equal(l.leave_hhmm, '09:25');
  assert.equal(l.line, '10:00 · leave 09:25');
  assert.equal(h.leaveBy('2026-11-12T10:00:00Z', 25, 0).leave_hhmm, '09:35');
  assert.equal(code(() => h.leaveBy('x', 10)), 'bad_request');
  assert.equal(code(() => h.leaveBy('2026-11-12T10:00:00Z', -1)), 'bad_request');
});

test('workoutForecast: null without history, then remaining × median pace', () => {
  gym.addExercise({ name: 'Squat' });
  gym.addRoutine({ name: 'Legs', items: [{ exercise: 'Squat', sets: 4 }] });
  const base = Date.parse('2026-11-01T19:30:00Z');
  const free = gym.startWorkout({ at: new Date(base - 86400000).toISOString() });
  assert.equal(h.workoutForecast(free.id as string), null); // no routine: nothing to forecast
  gym.finishWorkout(free.id as string, '', new Date(base - 86000000));
  const w1 = gym.startWorkout({ routine: 'Legs', at: new Date(base).toISOString() });
  for (let i = 0; i < 4; i++) gym.logSet({ workout_id: w1.id as string, exercise: 'Squat', weight: 80, reps: 5, at: new Date(base + i * 180000).toISOString() });
  gym.finishWorkout(w1.id as string, '', new Date(base + 800000));
  const b2 = Date.parse('2026-11-04T19:30:00Z');
  const w2 = gym.startWorkout({ routine: 'Legs', at: new Date(b2).toISOString() });
  gym.logSet({ workout_id: w2.id as string, exercise: 'Squat', weight: 80, reps: 5, at: new Date(b2).toISOString() });
  const f = h.workoutForecast(w2.id as string, new Date(b2 + 60000))!;
  assert.equal(f.remaining_sets, 3);
  assert.equal(f.pace_s, 180);
  assert.equal(f.finish_hhmm, '19:40'); // 19:31 + 9 min
  gym.finishWorkout(w2.id as string, '', new Date(b2 + 600000));
});

test('usualBuys: regular rhythm 3+ times, flagged when soon', () => {
  const day = '2026-11-20';
  const at = (d: string) => `${d}T10:00:00.000Z`;
  for (const d of ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13']) {
    run(`INSERT INTO shopping_items (id, created_at, updated_at, deleted_at, list, name, qty, done) VALUES (?, ?, ?, ?, 'Groceries', 'Eggs', NULL, 1)`, uuid(), at(d), at(d), at(d));
  }
  for (const d of ['2026-10-01', '2026-10-03', '2026-11-15']) {
    run(`INSERT INTO shopping_items (id, created_at, updated_at, deleted_at, list, name, qty, done) VALUES (?, ?, ?, NULL, 'Groceries', 'Batteries', NULL, 1)`, uuid(), at(d), at(d));
  }
  const u = h.usualBuys(day);
  assert.equal(u.length, 1);
  assert.equal(u[0].name, 'Eggs');
  assert.equal(u[0].every_days, 7);
  assert.match(u[0].line, /usually every ~7 days/);
  assert.equal(h.usualBuys('2026-11-14').length, 0); // just bought
  money.addShopping('eggs');
  assert.equal(h.usualBuys(day).length, 0); // already on the list
});

test('what-helped bank: add, list by situation, search, top', () => {
  const id = uuid();
  assert.equal(h.addHelped({ id, situation: 'Cannot start work', thing: 'Timer 10 minutes' }).id, id);
  h.addHelped({ situation: 'cannot start work', thing: 'timer 10 minutes', note: 'phone in other room' });
  h.addHelped({ situation: 'Evening slump', thing: 'Short walk' });
  assert.equal(h.listHelped('cannot start').length, 2);
  assert.equal(h.searchHelped('phone').length, 1);
  assert.equal(h.searchHelped('walk')[0].thing, 'Short walk');
  assert.deepEqual(h.helpedTop(1), [{ thing: 'Timer 10 minutes', times: 2 }]);
  assert.equal(code(() => h.addHelped({ situation: '', thing: 'x' })), 'bad_request');
});

test('experiments: one running, replay by id, end with note, no score', () => {
  const id = uuid();
  const e = h.startExperiment({ id, name: 'Phone in drawer during Launch', days: 7, start_day: lifeToday() });
  assert.equal(e.status, 'running');
  assert.equal(e.length_days, 7);
  assert.equal(e.day_n, 1);
  assert.equal(h.startExperiment({ id, name: 'again' }).id, id);
  assert.equal(code(() => h.startExperiment({ name: 'Second' })), 'conflict');
  assert.equal(h.runningExperiment()!.id, id);
  const done = h.endExperiment(id, 'Started faster on 4 of 7 days');
  assert.equal(done.status, 'ended');
  assert.equal(h.runningExperiment(), null);
  assert.ok(!('score' in done));
  assert.equal(h.startExperiment({ name: 'Next one', days: 3 }).status, 'running');
  assert.equal(code(() => h.startExperiment({ name: 'Too long', end_day: '2099-01-01' })), 'bad_request');
  assert.equal(h.listExperiments().length, 2);
});

test('swapOptions: later blocks today, Friday shift, Saturday none', () => {
  // 2026-11-12 is a Thursday
  const thu = h.swapOptions('2026-11-12', '🛠️ Project work · Build page', '2026-11-12T14:05:00Z');
  assert.deepEqual(thu.map((b) => b.name), ['Deep work', 'Meetings', 'Learning', 'Buffer']);
  assert.equal(thu[0].must, true);
  const late = h.swapOptions('2026-11-12', 'Deep work', '2026-11-12T16:40:00Z');
  assert.deepEqual(late.map((b) => b.name), ['Learning', 'Buffer']);
  assert.ok(!h.swapOptions('2026-11-12', 'Admin', '2026-11-12T11:00:00Z').some((b) => b.name === 'Kickoff'));
  const fri = h.blocksFor('2026-11-13').find((b) => b.name === 'Project work')!;
  assert.equal(fri.start, '14:10');
  assert.equal(fri.end, '15:00');
  assert.deepEqual(h.swapOptions('2026-11-14', 'Deep work', '2026-11-14T10:00:00Z'), []); // Saturday
  assert.deepEqual(h.swapOptions('2026-11-15', 'Weekly review', '2026-11-15T10:00:00Z'), []);
  assert.equal(code(() => h.swapOptions('2026-11-12', 'Gym', '2026-11-12T10:00:00Z')), 'bad_request');
});

test('habitatToday: home card shape, no guilt words', () => {
  const t = h.habitatToday('2026-11-14');
  assert.equal(t.rest_day, true);
  assert.ok(Array.isArray(t.usual_buys));
  assert.equal(typeof t.last_done_count, 'number');
  assert.ok('free_to_spend' in t);
  assert.ok(!BANNED.test(text(t)));
  assert.equal(code(() => h.habitatToday('x')), 'bad_request');
});
