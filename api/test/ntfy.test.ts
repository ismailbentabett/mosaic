import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-ntfy-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.NTFY_PORT = '9'; // nothing listens: sends fail fast, holds still work
mkdirSync(join(root, 'vault'), { recursive: true });
const { quiet, push, notify, cancelHeld, heldCount, heldList, flushHeld, pushLog, sleepWindow, getPushPrefs, setPushPrefs } = await import('../src/ntfy.ts');
const { schedulePush, scheduledList, snoozeTask, remindersTick, morningBrief, cancelTaskPushes, taskPush } = await import('../src/notify.ts');
const { pushStatus } = await import('../src/pushCenter.ts');
const { createServer } = await import('node:http');
const { getDb, kvSet } = await import('../src/db.ts');

// 2026-11-11 is a Wednesday, 2026-11-14 a Saturday.
const at = (s: string) => new Date(`${s}:00Z`);
const clear = () => {
  kvSet('mode', 'Normal'); kvSet('push_silence_until', ''); kvSet('push_prefs', '{}');
  for (const t of ['push_held', 'push_log', 'push_scheduled', 'push_marks', 'tasks', 'reminders']) getDb().prepare(`DELETE FROM ${t}`).run();
};
const hm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

// A stand-in ntfy that accepts every push, so the "sent" paths run for real.
const got: Record<string, unknown>[] = [];
const fake = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => { try { got.push(JSON.parse(b)); } catch { /* ignore */ } res.end('{}'); });
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
const fakePort = String((fake.address() as { port: number }).port);
/** Run fn with ntfy up (sends succeed). */
const up = async <T,>(fn: () => Promise<T>) => {
  process.env.NTFY_PORT = fakePort;
  try { return await fn(); } finally { process.env.NTFY_PORT = '9'; }
};
test.after(() => { fake.close(); });

let seq = 0;
const addTask = (t: { title: string; due_date?: string; due_time?: string; event_id?: string; priority?: number; status?: string; first_action?: string }) => {
  const id = `t${++seq}`;
  getDb().prepare(`INSERT INTO tasks (id, created_at, updated_at, title, status, priority, due_date, due_time, event_id, first_action)
    VALUES (?, '2026-11-11', '2026-11-11', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.title, t.status ?? 'open', t.priority ?? 0, t.due_date ?? null, t.due_time ?? null, t.event_id ?? null, t.first_action ?? null);
  return id;
};
const statuses = () => pushLog(500).map((r) => r.status).reverse();
// A daytime moment with no quiet rule in play.
const free = (day: string) => at(`${day}T11:45`);

test('sleep 23:30–07:30 holds until wake; priority 5 always goes', () => {
  clear();
  assert.deepEqual(sleepWindow(), { start: '23:30', wake: '07:30' });
  const q = quiet(3, at('2026-11-11T03:00'));
  assert.equal(q.quiet, true);
  assert.equal(q.quiet && q.reason, 'sleep');
  assert.equal(q.quiet && q.until?.slice(11, 16), '07:30');
  assert.equal(quiet(5, at('2026-11-11T03:00')).quiet, false);
  assert.equal(quiet(3, free('2026-11-11')).quiet, false);
});

test('profile sleep times win, including windows across midnight', () => {
  clear();
  getDb().prepare("INSERT OR REPLACE INTO profile_facts (key, value, source, confidence, updated_at) VALUES ('sleep.start', '\"23:00\"', 'test', 1, '2026-11-11'), ('sleep.wake', '\"07:00\"', 'test', 1, '2026-11-11')").run();
  try {
    const q = quiet(3, at('2026-11-11T23:30'));
    assert.equal(q.quiet && q.reason, 'sleep');
    assert.equal(q.quiet && q.until?.slice(0, 16), '2026-11-12T07:00');
    assert.equal(quiet(3, at('2026-11-11T03:00')).quiet && 'sleep', 'sleep');
    assert.notEqual((quiet(3, at('2026-11-11T08:00')) as { reason?: string }).reason, 'sleep');
  } finally { getDb().prepare("DELETE FROM profile_facts WHERE key IN ('sleep.start','sleep.wake')").run(); }
});

test('Saturday: below 4 held, 4 and up go', () => {
  clear();
  const t = free('2026-11-14');
  assert.equal((quiet(3, t) as { reason?: string }).reason, 'saturday');
  assert.equal(quiet(4, t).quiet, false);
});

test('Zero and Family mode: only priority 5', () => {
  clear();
  const t = free('2026-11-11');
  kvSet('mode', 'Family');
  assert.equal((quiet(4, t) as { reason?: string }).reason, 'mode');
  assert.equal(quiet(5, t).quiet, false);
  kvSet('mode', 'Zero');
  assert.equal((quiet(3, t) as { reason?: string }).reason, 'mode');
  clear();
});

test('held pushes: same key replaces, cancelHeld drops, nothing is lost', async () => {
  clear();
  const night = at('2026-11-11T03:00');
  assert.equal(await push({ title: 'a', message: '1', key: 'health:x' }, night), true);
  assert.equal(await push({ title: 'b', message: '2', key: 'health:x' }, night), true);
  assert.equal(await push({ title: 'c', message: '3' }, night), true);
  assert.equal(heldCount(), 2);
  assert.equal(cancelHeld('health:x'), true);
  assert.equal(cancelHeld('health:x'), false);
  assert.equal(heldCount(), 1);
  clear();
});

test('prefs: unknown categories ignored, numbers clamped, defaults sane', () => {
  clear();
  const d = getPushPrefs();
  assert.deepEqual([d.block_lead_min, d.hourly_cap, d.snooze_min], [2, 6, 10]);
  const p = setPushPrefs({ cats: { wishlist: false, nope: false } as Record<string, boolean>, block_lead_min: 99, hourly_cap: 0, snooze_min: 3 });
  assert.equal(p.cats.wishlist, false);
  assert.equal('nope' in p.cats, false);
  assert.equal(p.block_lead_min, 30);
  assert.equal(p.hourly_cap, 1);
  assert.equal(p.snooze_min, 5);
  assert.equal(getPushPrefs().cats.tasks, true);
  clear();
});

test('muted category: logged, not sent, not held; priority 5 ignores the switch', async () => {
  clear();
  setPushPrefs({ cats: { wishlist: false } });
  const t = free('2026-11-11');
  const r = await up(() => notify({ title: 'Price drop', message: 'x', cat: 'wishlist' }, t));
  assert.equal(r.status, 'muted');
  assert.equal(heldCount(), 0);
  assert.equal((await up(() => notify({ title: 'Price drop', message: 'urgent', cat: 'wishlist', priority: 5 }, t))).status, 'sent');
  assert.deepEqual(statuses(), ['muted', 'sent']);
  clear();
});

test('same push twice in 10 min is deduped; after 10 min it goes again', async () => {
  clear();
  const t = free('2026-11-11');
  const m = { title: 'Call the bank', message: 'Due 14:00' };
  assert.equal((await up(() => notify(m, t))).status, 'sent');
  assert.equal((await up(() => notify(m, new Date(t.getTime() + 5 * 60_000)))).status, 'deduped');
  assert.equal((await up(() => notify(m, new Date(t.getTime() + 11 * 60_000)))).status, 'sent');
  clear();
});

test('burst cap: past hourly_cap pushes are held as burst; priority 4 still goes', async () => {
  clear();
  setPushPrefs({ hourly_cap: 2 });
  const t = free('2026-11-11');
  const go = (i: number, priority: 3 | 4 = 3) => up(() => notify({ title: `n${i}`, message: 'x', priority }, new Date(t.getTime() + i * 60_000)));
  assert.equal((await go(1)).status, 'sent');
  assert.equal((await go(2)).status, 'sent');
  const third = await go(3);
  assert.equal(third.status, 'held');
  assert.equal(third.reason, 'burst');
  assert.ok(third.until);
  assert.equal((await go(4, 4)).status, 'sent');
  assert.equal(heldList()[0]?.reason, 'burst');
  clear();
});

test('ntfy down: held as retry, flushed once it is back, logged as retried', async () => {
  clear();
  const t = free('2026-11-11');
  const r = await notify({ title: 'Lost?', message: 'no' }, t);
  assert.equal(r.status, 'held');
  assert.equal(r.reason, 'retry');
  assert.equal(heldCount(), 1);
  const f = await up(() => flushHeld(new Date(t.getTime() + 60_000)));
  assert.deepEqual(f, { sent: 1, held: 0 });
  assert.equal(pushLog(1)[0].reason, 'retried');
  clear();
});

test('retry holds expire after an hour, never sent stale', async () => {
  clear();
  const t = free('2026-11-11');
  await notify({ title: 'Old', message: 'x' }, t);
  const f = await up(() => flushHeld(new Date(t.getTime() + 61 * 60_000)));
  assert.deepEqual(f, { sent: 0, held: 0 });
  clear();
});

test('force: goes through quiet hours and muted categories, logged as test', async () => {
  clear();
  setPushPrefs({ cats: { custom: false } });
  const night = at('2026-11-11T03:00');
  const r = await up(() => notify({ title: 'Mosaic test', message: 'x', cat: 'custom', force: true }, night));
  assert.equal(r.status, 'sent');
  assert.equal(pushLog(1)[0].reason, 'test');
  assert.equal((await notify({ title: 'Mosaic test', message: 'y', force: true }, night)).status, 'failed');
  clear();
});

test('flush after sleep: at most 3 single pushes, the rest in one digest', async () => {
  clear();
  const night = at('2026-11-11T03:00');
  for (let i = 0; i < 6; i++) await push({ title: `h${i}`, message: 'x' }, night);
  assert.equal(heldCount(), 6);
  got.length = 0;
  const f = await up(() => flushHeld(at('2026-11-11T10:31')));
  assert.equal(f.sent, 6);
  assert.equal(got.length, 3); // 2 singles + 1 digest
  assert.match(String(got[2].title), /While you were away: 4 more/);
  assert.equal(heldCount(), 0);
  clear();
});

test('task push: heads-up text, priority label, tap link and buttons', () => {
  clear();
  const m = taskPush({ id: 'tx', title: 'Draft 3 pages', due_date: '2026-11-11', due_time: '15:30', est_minutes: 50, first_action: 'Open the doc.', done_def: '3 drafted', priority: 3, event_id: 'ev1', status: 'open' }, 'block', 2);
  assert.equal(m.priority, 4);
  assert.equal(m.cat, 'blocks');
  assert.equal(m.key, 'task:tx');
  assert.match(m.message, /In 2 min \(15:30\) · 50m · Priority/);
  assert.match(m.message, /First: Open the doc\./);
  assert.match(m.message, /Done = 3 drafted\./);
  assert.match(String(m.click), /^mosaic:\/\/open\?to=today/);
  assert.equal(m.actions?.length, 3);
  clear();
});

test('task reminder fires once at its time; block heads-up fires lead minutes early', async () => {
  clear();
  const day = '2026-11-11';
  const t = free(day);
  addTask({ title: 'Call the bank', due_date: day, due_time: hm(t) });
  const blockAt = new Date(t.getTime() + 5 * 60_000);
  addTask({ title: 'Deep work task', due_date: day, due_time: hm(blockAt), event_id: 'ev2', priority: 3 });
  assert.equal((await up(() => remindersTick(t))).tasks, 1);
  assert.equal((await up(() => remindersTick(new Date(t.getTime() + 60_000)))).tasks, 0, 'never twice');
  assert.equal((await up(() => remindersTick(new Date(blockAt.getTime() - 2 * 60_000)))).tasks, 1, 'block heads-up at lead 2');
  // Found more than 10 min late (server was down): skipped, never sent stale.
  addTask({ title: 'Late one', due_date: day, due_time: hm(new Date(t.getTime() - 20 * 60_000)) });
  assert.equal((await up(() => remindersTick(t))).tasks, 0);
  clear();
});

test('done tasks do not ping', async () => {
  clear();
  const t = free('2026-11-11');
  addTask({ title: 'Done already', due_date: '2026-11-11', due_time: hm(t), status: 'done' });
  assert.equal((await up(() => remindersTick(t))).tasks, 0);
  clear();
});

test('scheduled push: HH:MM rolls to tomorrow when passed, fires once, then gone', async () => {
  clear();
  const t = free('2026-11-11');
  const s = schedulePush({ at: '00:05', title: 'Buy bread' }, t);
  assert.equal(Date.parse(s.at), at('2026-11-12T00:05').getTime(), 'passed today: tomorrow 00:05');
  assert.ok(Date.parse(s.at) > t.getTime(), 'in the future');
  const soon = schedulePush({ at: new Date(t.getTime() + 2 * 60_000).toISOString(), title: 'Soon', message: 'Pick up keys' }, t);
  assert.equal(scheduledList().length, 2);
  assert.equal((await up(() => remindersTick(new Date(t.getTime() + 60_000)))).scheduled, 0);
  assert.equal((await up(() => remindersTick(new Date(t.getTime() + 3 * 60_000)))).scheduled, 1);
  assert.equal(scheduledList().some((x) => x.id === soon.id), false);
  assert.throws(() => schedulePush({ at: new Date(t.getTime() - 5 * 60_000).toISOString(), title: 'past' }, t), /passed/);
  assert.throws(() => schedulePush({ at: '12:00' }, t), /title/);
  clear();
});

test('snooze: one per task, comes back as the task push; done meanwhile = nothing', async () => {
  clear();
  const t = free('2026-11-11');
  const id = addTask({ title: 'Write proposal', due_date: '2026-11-11' });
  snoozeTask(id, 10, t);
  snoozeTask(id, 15, t);
  assert.equal(scheduledList().length, 1, 'same key replaces');
  got.length = 0;
  assert.equal((await up(() => remindersTick(new Date(t.getTime() + 16 * 60_000)))).scheduled, 1);
  assert.equal(got[0]?.title, 'Write proposal');
  assert.match(String(got[0]?.message), /Back from snooze/);
  snoozeTask(id, 10, t);
  getDb().prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
  got.length = 0;
  await up(() => remindersTick(new Date(t.getTime() + 11 * 60_000)));
  assert.equal(got.length, 0);
  clear();
});

test('cancelTaskPushes drops the snooze and the held push for that task', async () => {
  clear();
  const id = addTask({ title: 'X', due_date: '2026-11-11' });
  snoozeTask(id, 10, free('2026-11-11'));
  await push({ title: 'X', message: 'y', key: `task:${id}` }, at('2026-11-11T03:00'));
  assert.equal(heldCount(), 1);
  cancelTaskPushes(id);
  assert.equal(scheduledList().length, 0);
  assert.equal(heldCount(), 0);
  clear();
});

test('morning brief: once a day after wake, never on Saturday', async () => {
  clear();
  addTask({ title: 'Draft 3 pages', due_date: '2026-11-11', due_time: '15:30', event_id: 'ev3', priority: 3, first_action: 'Open the doc' });
  addTask({ title: 'Read 20 min', due_date: '2026-11-11' });
  const b = morningBrief('2026-11-11');
  assert.equal(b.cat, 'brief');
  assert.match(b.message, /Priority: Draft 3 pages/);
  assert.match(b.message, /First at 15:30: Draft 3 pages\. First: Open the doc\./);
  assert.match(b.message, /2 tasks today\./);
  assert.match(morningBrief('2026-11-20').message, /Nothing planned/);
  assert.equal((await up(() => remindersTick(at('2026-11-11T07:30')))).brief, 0, 'not before wake + 5');
  assert.equal((await up(() => remindersTick(at('2026-11-11T07:36')))).brief, 1);
  assert.equal((await up(() => remindersTick(at('2026-11-11T07:40')))).brief, 0, 'once');
  assert.equal((await up(() => remindersTick(at('2026-11-14T07:40')))).brief, 0, 'Saturday');
  clear();
});

test('pushStatus: one read with gate, counts and upcoming', async () => {
  clear();
  const t = free('2026-11-11');
  await up(() => notify({ title: 'a', message: '1' }, t));
  setPushPrefs({ cats: { custom: false } });
  await notify({ title: 'b', message: '2' }, t);
  schedulePush({ at: new Date(t.getTime() + 30 * 60_000).toISOString(), title: 'Later' }, t);
  const s = pushStatus(t);
  assert.equal(s.quiet, false);
  assert.equal(s.last24h.sent, 1);
  assert.equal(s.last24h.muted, 1);
  assert.equal(s.last_sent?.title, 'a');
  assert.ok(s.upcoming.some((u) => u.kind === 'scheduled' && u.title === 'Later'));
  assert.equal(pushStatus(at('2026-11-11T03:00')).quiet, true);
  clear();
});
