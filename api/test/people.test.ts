import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-people-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_TZ = 'UTC';
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });

const pp = await import('../src/modules/people/store.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const money = await import('../src/modules/money/store.ts');
const { run, uuid, now } = await import('../src/modules/util.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

const WED = '2026-11-11';
const SAT = '2026-11-14';
const BANNED = /missed|overdue|streak|late|behind|should|fail/i;

test('promises: add, list open, keep, release, soon window', () => {
  const t = tasks.addTask({ title: 'Send Karim the photos' });
  const a = pp.addPromise({ who: 'Karim', what: 'Send the wedding photos', due: '2026-11-12', source: 'call', task_id: t.id });
  assert.equal(a.status, 'open');
  assert.equal(a.task_id, t.id);
  const b = pp.addPromise({ who: 'Mum', what: 'Fix the router', due: '2026-11-13' });
  const c = pp.addPromise({ who: 'Amine', what: 'Lend the drill', due: '2026-11-20' });
  const d = pp.addPromise({ who: 'Sara', what: 'Recommend a book' }); // no due
  const e = pp.addPromise({ who: 'Yacine', what: 'Return the charger', due: '2026-11-09' }); // date already passed
  assert.equal(pp.listPromises().length, 5);

  const soon = pp.promisesSoon(WED);
  const ids = soon.map((x) => x.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id) && ids.includes(e.id));
  assert.ok(!ids.includes(c.id) && !ids.includes(d.id));
  assert.equal(soon.find((x) => x.id === a.id)!.when, 'tomorrow');
  assert.equal(soon.find((x) => x.id === b.id)!.when, 'in 2 days');
  assert.equal(soon.find((x) => x.id === e.id)!.when, 'from Mon 9 Nov');
  assert.equal(soon.find((x) => x.id === b.id)!.days_until, 2);
  for (const s of soon) assert.ok(!BANNED.test(s.when));

  assert.equal(pp.keepPromise(a.id, WED).status, 'kept');
  assert.equal(pp.keepPromise(a.id, WED).closed_day, WED); // idempotent
  const r = pp.releasePromise(e.id, WED);
  assert.equal(r.status, 'released');
  assert.equal(pp.listPromises().length, 3);
  assert.equal(pp.listPromises('kept').length, 1);
  assert.equal(pp.listPromises('released').length, 1);
  assert.equal(pp.listPromises('all').length, 5);
  assert.equal(pp.promisesSoon(WED).length, 1); // only b left in window
  assert.equal(pp.reopenPromise(e.id).status, 'open');
  assert.equal(pp.updatePromise(e.id, { due: null }).due, null);
});

test('promises: validation and Saturday quiet', () => {
  assert.equal(code(() => pp.addPromise({ who: '', what: 'x' })), 'bad_request');
  assert.equal(code(() => pp.addPromise({ who: 'A', what: 'x', due: '2026-13-01' })), 'bad_request');
  assert.equal(code(() => pp.addPromise({ who: 'A', what: 'x', task_id: 'no-such-task-0000' })), 'not_found');
  assert.equal(code(() => pp.keepPromise('no-such-promise-0')), 'not_found');
  assert.equal(code(() => pp.listPromises('bogus' as never)), 'bad_request');
  pp.addPromise({ who: 'Nadia', what: 'Call back', due: SAT });
  assert.deepEqual(pp.promisesSoon(SAT), []);
  assert.ok(pp.promisesSoon('2026-11-13').some((p) => p.who === 'Nadia'));
});

test('tiny habit: set, read, tiny vs full stats, no streak fields', () => {
  const h = tasks.addHabit('Reading', 7) as any;
  assert.equal(pp.tinyFor(h.id), null);
  assert.equal(pp.setTiny(h.id, '1 page').tiny, '1 page');
  assert.equal(pp.tinyFor(h.id), '1 page');
  assert.equal(pp.setTiny('reading', '2 pages').tiny, '2 pages'); // by name, upsert
  assert.equal(pp.tinyFor(h.id), '2 pages');

  const c = pp.checkTiny(h.id, '2026-11-09');
  assert.equal(c.kind, 'tiny');
  assert.equal(c.count, 1);
  assert.equal(c.tiny, '2 pages');
  pp.checkFull(h.id, '2026-11-10');
  tasks.checkHabit(h.id, '2026-11-11'); // plain check counts as full
  pp.checkTiny(h.id, '2026-11-12');
  pp.checkFull(h.id, '2026-11-12'); // upgrade tiny → full same day

  const s = pp.tinyStats(h.id, '2026-11-09', '2026-11-15');
  assert.deepEqual({ days: s.days_checked, tiny: s.tiny, full: s.full }, { days: 4, tiny: 1, full: 3 });
  assert.ok(!Object.keys(s).some((k) => /streak/i.test(k)));
  // the existing habit list sees tiny checks too
  const listed = tasks.listHabits('2026-11-12').find((x: any) => x.id === h.id)!;
  assert.equal(listed.this_week, 4);

  assert.equal(pp.setTiny(h.id, '').tiny, null);
  assert.equal(pp.tinyFor(h.id), null);
  assert.equal(code(() => pp.tinyFor('nope-habit-000')), 'not_found');
  assert.equal(code(() => pp.checkTiny(h.id, '2026-02-30')), 'bad_request');
  assert.equal(code(() => pp.tinyStats(h.id, 'x', '2026-11-15')), 'bad_request');
});

test('time capsule: sealed until date, due list, open', () => {
  const a = pp.writeCapsule({ body: 'Dear future me: did the car fund grow?', title: 'Car', open_on: '2026-12-01' }, WED);
  assert.equal(a.sealed, true);
  assert.equal(a.body, null);
  const b = pp.writeCapsule({ body: 'Ten days later note', in_days: 10 }, WED);
  assert.equal(b.open_on, '2026-11-21');

  assert.equal(pp.getCapsule(a.id, WED).body, null);
  assert.ok(pp.listCapsules(WED).every((c) => c.body === null));
  assert.equal(code(() => pp.openCapsule(a.id, WED)), 'bad_request');
  assert.deepEqual(pp.capsulesDue(WED), []);

  const due = pp.capsulesDue('2026-11-22'); // Sunday
  assert.equal(due.length, 1);
  assert.equal(due[0].id, b.id);
  assert.equal(due[0].body, 'Ten days later note');
  assert.deepEqual(pp.capsulesDue('2026-11-21'), []); // Saturday: quiet

  const o = pp.openCapsule(b.id, '2026-11-22');
  assert.ok(o.opened_at);
  assert.equal(o.body, 'Ten days later note');
  assert.equal(pp.openCapsule(b.id, '2026-11-22').opened_at, o.opened_at); // idempotent
  assert.deepEqual(pp.capsulesDue('2026-11-22'), []);
  assert.equal(pp.capsulesDue('2026-12-01').length, 1);

  assert.equal(code(() => pp.writeCapsule({ body: '' , in_days: 3 }, WED)), 'bad_request');
  assert.equal(code(() => pp.writeCapsule({ body: 'x' }, WED)), 'bad_request');
  assert.equal(code(() => pp.writeCapsule({ body: 'x', open_on: WED }, WED)), 'bad_request');
  assert.equal(code(() => pp.writeCapsule({ body: 'x', in_days: 0 }, WED)), 'bad_request');
  assert.equal(code(() => pp.openCapsule('no-such-capsule', WED)), 'not_found');
  assert.equal(pp.deleteCapsule(a.id).deleted, true);
  assert.equal(code(() => pp.getCapsule(a.id, WED)), 'not_found');
});

test('people light: add, reject unknown relations, cadence due, touch', () => {
  assert.equal(code(() => pp.addPerson({ name: 'Sam Lee', relation: 'coworker' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'Plumber', relation: 'neighbour' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'Plumber', relation: 'Coworker' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'X', relation: 'cousin' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'X', birthday: '13-01' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'X', birthday: '02-30' })), 'bad_request');
  assert.equal(code(() => pp.addPerson({ name: 'X', cadence_days: 0 })), 'bad_request');

  const p = pp.addPerson({ name: 'Karim', relation: 'friend', last_contact: '2026-11-01', cadence_days: 7 });
  const q = pp.addPerson({ name: 'Aunt Fatima', relation: 'family', last_contact: '2026-11-08', cadence_days: 14 });
  const r = pp.addPerson({ name: 'Old classmate' }); // no cadence: never due
  assert.equal(r.relation, 'other');
  assert.equal(pp.addPerson({ name: 'Leap kid', birthday: '02-29' }).birthday, '02-29');
  assert.equal(code(() => pp.updatePerson(p.id, { relation: 'coworker' })), 'bad_request');

  const due = pp.peopleDue(WED);
  assert.deepEqual(due.map((x) => x.id), [p.id]);
  assert.equal(due[0].note, 'Could reach out');
  assert.equal(due[0].days_since, 10);
  for (const x of due) assert.ok(!BANNED.test(x.note));
  assert.deepEqual(pp.peopleDue(SAT), []); // Saturday quiet
  assert.ok(pp.peopleDue('2026-11-22').some((x) => x.id === q.id));

  const t = pp.touch('karim', WED, 'tea');
  assert.equal(t.last_contact, WED);
  assert.ok(!pp.peopleDue(WED).some((x) => x.id === p.id));
  pp.touch(p.id, '2026-11-05'); // older log does not move last contact back
  assert.equal(pp.findPerson(p.id).last_contact, WED);
  assert.equal(pp.contactsOf(p.id).length, 2);
  assert.ok(pp.peopleDue('2026-11-18').some((x) => x.id === p.id));

  assert.equal(pp.listPeople('family').length, 1);
  assert.equal(code(() => pp.listPeople('coworker')), 'bad_request');
  assert.equal(pp.updatePerson(r.id, { cadence_days: 30, note: 'school' }).cadence_days, 30);
  assert.equal(pp.deletePerson(r.id).deleted, true);
  assert.equal(code(() => pp.findPerson(r.id)), 'not_found');
});

test('occasions: next occurrence, year wrap, Feb 29 in non-leap year, lead days, person birthdays', () => {
  assert.equal(pp.dateInYear('02-29', 2027), '2027-02-28');
  assert.equal(pp.dateInYear('02-29', 2028), '2028-02-29');
  assert.equal(pp.nextOccurrence('02-29', '2027-01-20'), '2027-02-28');
  assert.equal(pp.nextOccurrence('02-29', '2027-03-01'), '2028-02-29');
  assert.equal(pp.nextOccurrence('01-02', '2026-12-30'), '2027-01-02');
  assert.equal(pp.nextOccurrence('11-11', WED), WED);

  const mum = pp.findPerson('Aunt Fatima');
  const ann = pp.addOccasion({ name: 'Parents anniversary', kind: 'anniversary', date: '1995-11-20', person_id: mum.id });
  assert.equal(ann.md, '11-20');
  assert.equal(ann.year, 1995);
  const ny = pp.addOccasion({ name: 'New year call', md: '01-02' });
  const far = pp.addOccasion({ name: 'Big reminder', md: '12-20', lead_days: 45 });
  pp.addOccasion({ name: 'Leap thing', md: '02-29', lead_days: 0 });
  assert.equal(code(() => pp.addOccasion({ name: 'Bad', md: '02-30' })), 'bad_request');
  assert.equal(code(() => pp.addOccasion({ name: 'Bad', md: '1-2' })), 'bad_request');
  assert.equal(code(() => pp.addOccasion({ name: 'Bad', md: '03-03', kind: 'meeting' })), 'bad_request');
  assert.equal(code(() => pp.addOccasion({ name: 'Bad', md: '03-03', person_id: 'nobody-here-0' })), 'not_found');

  const soon = pp.occasionsSoon(WED);
  const a = soon.find((x) => x.id === ann.id)!;
  assert.equal(a.days_until, 9);
  assert.equal(a.years, 31);
  assert.equal(a.person_name, 'Aunt Fatima');
  assert.ok(soon.some((x) => x.id === far.id)); // 39 days, inside its own 45 lead days
  assert.ok(!soon.some((x) => x.id === ny.id));
  const wrap = pp.occasionsSoon('2026-12-25', 14);
  assert.equal(wrap.find((x) => x.id === ny.id)!.days_until, 8);
  assert.equal(wrap.find((x) => x.id === ny.id)!.date, '2027-01-02');

  // person birthday on Feb 29 → Feb 28 in 2027
  const leap = pp.occasionsSoon('2027-02-20', 14).find((x) => x.name === "Leap kid's birthday")!;
  assert.equal(leap.date, '2027-02-28');
  assert.equal(leap.days_until, 8);
  const leapOcc = pp.occasionsSoon('2027-02-27', 3).find((x) => x.name === 'Leap thing')!;
  assert.equal(leapOcc.date, '2027-02-28');

  // occasions are still shown on Saturday
  assert.ok(pp.occasionsSoon(SAT).some((x) => x.id === ann.id));
  // birthday with a year gives an age; a person with a birthday occasion is not listed twice
  const z = pp.addPerson({ name: 'Zineb', relation: 'family', birthday: '2001-11-15' });
  const zs = pp.occasionsSoon(WED).filter((x) => x.person_id === z.id);
  assert.equal(zs.length, 1);
  assert.equal(zs[0].years, 25);
  pp.addOccasion({ name: 'Zineb birthday party', kind: 'birthday', md: '11-15', person_id: z.id });
  assert.equal(pp.occasionsSoon(WED).filter((x) => x.person_id === z.id).length, 1);
  assert.equal(pp.updateOccasion(ny.id, { lead_days: 60 }).lead_days, 60);
  assert.ok(pp.occasionsSoon(WED).some((x) => x.id === ny.id));
  assert.equal(code(() => pp.occasionsSoon(WED, -1)), 'bad_request');
});

test('waiting check-on: default 5 days, explicit date, Saturday quiet', () => {
  const t = tasks.addTask({ title: 'Get quote from mechanic', waiting_for: 'Mechanic' });
  const plain = tasks.addTask({ title: 'Not waiting' });
  run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, '2026-11-03T10:00:00.000Z', t.id);
  const list = pp.waitingList();
  assert.equal(list.length, 1);
  assert.equal(list[0].check_on, '2026-11-08');
  assert.equal(list[0].auto, true);
  assert.deepEqual(pp.waitingDue('2026-11-07'), []);
  const due = pp.waitingDue('2026-11-08');
  assert.equal(due.length, 1);
  assert.equal(due[0].note, 'Could check in');
  assert.deepEqual(pp.waitingDue(SAT), []);

  const s = pp.setCheckOn(t.id, { in_days: 3 }, WED);
  assert.equal(s.check_on, '2026-11-14');
  assert.deepEqual(pp.waitingDue('2026-11-13'), []);
  assert.equal(pp.waitingDue('2026-11-15').length, 1);
  assert.equal(pp.setCheckOn(t.id, { day: '2026-11-12' }).check_on, '2026-11-12');
  // manual date survives a change of waiting_for
  tasks.updateTask(t.id, { waiting_for: 'Garage' });
  assert.equal(pp.waitingList()[0].check_on, '2026-11-12');

  // auto default resets when the wait changes
  const u = tasks.addTask({ title: 'Wait on cousin', waiting_for: 'Cousin' });
  run(`UPDATE tasks SET updated_at = ? WHERE id = ?`, '2026-11-01T10:00:00.000Z', u.id);
  assert.equal(pp.waitingList().find((x) => x.task_id === u.id)!.check_on, '2026-11-06');
  run(`UPDATE tasks SET waiting_for = 'Uncle', updated_at = ? WHERE id = ?`, '2026-11-10T10:00:00.000Z', u.id);
  assert.equal(pp.waitingList().find((x) => x.task_id === u.id)!.check_on, '2026-11-15');
  // done tasks drop out
  tasks.completeTask(u.id);
  assert.ok(!pp.waitingList().some((x) => x.task_id === u.id));

  assert.equal(code(() => pp.setCheckOn(plain.id, { in_days: 2 })), 'bad_request');
  assert.equal(code(() => pp.setCheckOn(t.id, {})), 'bad_request');
  assert.equal(code(() => pp.setCheckOn(t.id, { day: 'soon' })), 'bad_request');
});

test('week facts and 14-day strip: neutral counts, life-day bucketing', () => {
  // A fixed past week: 2025-11-17 (Mon) .. 2025-11-23 (Sun). It must not be the real current week:
  // earlier tests complete tasks and keep promises at now(), which would leak into a current-week count.
  const mk = (title: string, doneAt: string) => {
    const t = tasks.addTask({ title });
    run(`UPDATE tasks SET status = 'done', done_at = ? WHERE id = ?`, doneAt, t.id);
  };
  mk('Done Mon', '2025-11-17T12:00:00.000Z');
  mk('Done Tue', '2025-11-18T09:00:00.000Z');
  mk('Done before week (Mon 01:30 local = Sun life-day of prior week)', '2025-11-17T01:30:00.000Z');

  tasks.logFocus(null, 50, '2025-11-17T11:30:00Z');
  tasks.logFocus(null, 25, '2025-11-18T02:30:00Z'); // life-day Mon 16
  tasks.logFocus(null, 30, '2025-11-25T12:00:00Z'); // outside the week

  const h = tasks.addHabit('Walk', 5) as any;
  tasks.checkHabit(h.id, '2025-11-17');
  tasks.checkHabit(h.id, '2025-11-19');

  const t = now();
  run(`INSERT INTO workouts (id, name, started_at, status, day, created_at, updated_at) VALUES (?, 'Push', ?, 'done', '2025-11-18', ?, ?)`,
    uuid(), '2025-11-18T19:30:00Z', t, t);
  run(`INSERT INTO food_log (id, day, slot, at, name, kcal, created_at, updated_at) VALUES (?, '2025-11-17', 'lunch', ?, 'Rice', 400, ?, ?)`,
    uuid(), t, t, t);
  run(`INSERT INTO food_log (id, day, slot, at, name, kcal, created_at, updated_at) VALUES (?, '2025-11-17', 'dinner', ?, 'Soup', 300, ?, ?)`,
    uuid(), t, t, t);
  run(`INSERT INTO day_status (day, status) VALUES ('2025-11-20', 'partial')`);

  const cash = money.addAccount({ name: 'Wallet', currency: 'USD', opening_balance: 100 }) as any;
  const biz = money.addAccount({ name: 'Biz', currency: 'USD', track: 'business', opening_balance: 0 }) as any;
  money.addRecord({ account: cash.id, amount: 12.5, day: '2025-11-17', rate_to_usd: 1 });
  money.addRecord({ account: cash.id, amount: 7.25, day: '2025-11-19', rate_to_usd: 1 });
  money.addRecord({ account: cash.id, amount: 100, kind: 'income', day: '2025-11-19', rate_to_usd: 1 });
  money.addRecord({ account: biz.id, amount: 50, day: '2025-11-19', rate_to_usd: 1 });

  const pr = pp.addPromise({ who: 'Bilal', what: 'Bring the book' });
  pp.keepPromise(pr.id, '2025-11-20');

  const w = pp.weekFacts('2025-11-19'); // any day normalises to Monday
  assert.equal(w.week_start, '2025-11-17');
  assert.equal(w.week_end, '2025-11-23');
  assert.equal(w.tasks_done, 2);
  assert.equal(w.focus_minutes, 75);
  assert.equal(w.habit_checks, 2);
  assert.equal(w.gym_workouts, 1);
  assert.equal(w.expenses, 2);
  assert.equal(w.spend_personal_usd, 19.75);
  assert.equal(w.food_days_logged, 2);
  assert.equal(w.promises_kept, 1);
  assert.ok(!Object.keys(w).some((k) => /score|streak|should|missed/i.test(k)));

  const empty = pp.weekFacts('2030-01-07');
  assert.equal(empty.tasks_done + empty.focus_minutes + empty.gym_workouts + empty.expenses, 0);
  assert.equal(code(() => pp.weekFacts('nope')), 'bad_request');

  const s = pp.strip14('2025-11-23');
  assert.equal(s.length, 14);
  assert.equal(s[0].day, '2025-11-10');
  assert.equal(s[13].day, '2025-11-23');
  const mon = s.find((x) => x.day === '2025-11-17')!;
  assert.deepEqual(mon, { day: '2025-11-17', tasks_done: 1, focus_min: 75, gym: false, habits_checked: 1, spend_usd: 12.5, food_logged: true });
  const tue = s.find((x) => x.day === '2025-11-18')!;
  assert.equal(tue.gym, true);
  assert.equal(tue.tasks_done, 1);
  assert.equal(s.find((x) => x.day === '2025-11-20')!.food_logged, true);
  assert.equal(s.find((x) => x.day === '2025-11-16')!.tasks_done, 1); // the 01:30Z done task belongs to Sunday's life-day
  const quiet = s.find((x) => x.day === '2025-11-22')!;
  assert.deepEqual(quiet, { day: '2025-11-22', tasks_done: 0, focus_min: 0, gym: false, habits_checked: 0, spend_usd: 0, food_logged: false });
});
