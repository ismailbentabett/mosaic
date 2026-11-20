import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-extras-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_TZ = 'UTC';
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });

const x = await import('../src/modules/extras/store.ts');
const money = await import('../src/modules/money/store.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('next anchor and timer guard', () => {
  const at = new Date('2026-11-11T11:50:00Z');
  const n = x.nextAnchor(at)!;
  assert.equal(n.key, 'lunch');
  assert.equal(n.in_minutes, 70);
  assert.ok(n.in_minutes > 0);
  const g = x.timerGuard(120, at);
  assert.equal(g.ok, false);
  assert.ok(g.suggest_minutes! >= 5 && g.suggest_minutes! < 120);
  assert.equal(x.timerGuard(5, at).ok, true);
  assert.equal(code(() => x.timerGuard(0, at)), 'bad_request');
  // at the last anchor of the day: next anchor is tomorrow's breakfast
  assert.equal(x.nextAnchor(new Date('2026-11-11T23:30:00Z'))!.key, 'breakfast');
});

test('documents: register, reminders fire once per threshold', () => {
  const d = x.addDocument({ name: 'Passport', expires_on: '2026-12-31', where_kept: 'drawer' });
  assert.equal(d.name, 'Passport');
  assert.equal(code(() => x.addDocument({ name: '' })), 'bad_request');
  const first = x.documentReminders('2026-11-11');
  assert.equal(first.length, 1);
  assert.equal(first[0].name, 'Passport');
  assert.equal(x.documentReminders('2026-11-12').length, 0);
  x.deleteDocument(d.id);
  assert.equal(x.listDocuments().length, 0);
});

test('wishlist cool-off, afford', () => {
  money.setRate('EUR', 1.1, '2026-11-01');
  money.addAccount({ name: 'Cash', currency: 'USD', opening_balance: 1000 });
  const at = new Date('2026-11-11T12:00:00Z');
  const cheap = x.addWish({ name: 'Cable', price: 7, currency: 'EUR' }, at);
  assert.equal(cheap.ready, true);
  const big = x.addWish({ name: 'Headphones', price: 275, currency: 'EUR' }, at);
  assert.equal(big.ready, false);
  assert.ok(big.hours_left > 70);
  assert.equal(x.wishlistReady(at).length, 0);
  const later = new Date(at.getTime() + 73 * 3600000);
  assert.equal(x.wishlistReady(later).length, 1);
  assert.equal(x.wishlistReady(later).length, 0);
  assert.equal(x.setWishStatus(big.id, 'dropped').status, 'dropped');

  const a = x.afford(100, 'EUR', '2026-11-11') as Record<string, unknown>;
  assert.ok(typeof a.usd === 'number');
  // default: paid from living cash, the car fund is untouched
  assert.equal(a.from, 'living_cash');
  assert.equal(a.car_fund, null);
  assert.equal(a.cash_after_usd, Math.round((Number(a.cash_usd) - Number(a.usd)) * 100) / 100);
  assert.equal(code(() => x.afford(100, 'EUR', '2026-11-11', 'car')), 'bad_request'); // no car fund yet
  money.addAccount({ name: 'Car box', currency: 'USD', opening_balance: 2000 });
  money.addSavingsGoal({ name: 'Car fund', target_usd: 8000, target_date: '2027-06-01', account: 'Car box' });
  const fromCar = x.afford(100, 'EUR', '2026-11-11', 'car') as Record<string, any>;
  assert.equal(fromCar.from, 'savings_goal');
  assert.equal(fromCar.cash_after_usd, fromCar.cash_usd); // living cash unchanged
  assert.equal(fromCar.car_fund.saved_after_usd, Math.round((fromCar.car_fund.saved_usd - fromCar.usd) * 100) / 100);
  assert.equal(code(() => x.afford(0)), 'bad_request');
});

test('FSRS cards: draft, queue, review moves due forward', () => {
  const dr = x.draftCard('la fenêtre - the window');
  assert.equal(dr.front, 'la fenêtre');
  assert.equal(dr.back, 'the window');
  assert.equal(dr.gender, 'f');
  const at = new Date('2026-11-11T12:00:00Z');
  const c = x.addCard({ front: dr.front, back: dr.back, gender: dr.gender }, at);
  assert.equal(x.cardQueue(20, at).cards.length >= 1, true);
  const r = x.reviewCard(c.id, 3, at) as Record<string, any>;
  const card = x.getCard(c.id);
  assert.ok(Date.parse(String(card.due)) > at.getTime(), JSON.stringify(r));
  assert.equal(code(() => x.reviewCard(c.id, 7, at)), 'bad_request');
  assert.ok(x.intervalDays(10) >= 1);
});

test('brain dump draft sorts lines', () => {
  const items = x.brainDumpDraft('- call the bank\n- paid 5 usd bread\nnote: maybe sell the bike\nwhy am I tired?');
  assert.deepEqual(items.map((i) => i.kind), ['task', 'expense', 'note', 'note']);
});

test('signed push actions: done, later, tamper, expiry', () => {
  const t = tasks.addTask({ title: 'Reply to Karim', est_minutes: 20 });
  const tok = x.signAction('done', t.id);
  assert.equal(x.verifyAction(tok).t, t.id);
  assert.equal(code(() => x.verifyAction(tok.slice(0, -2) + 'xx')), 'bad_request');
  const old = x.signAction('later', t.id, 1, new Date('2026-01-01T00:00:00Z'));
  assert.equal(code(() => x.verifyAction(old)), 'bad_request');
  const start = x.performAction(x.signAction('start', t.id)) as Record<string, unknown>;
  assert.ok(Number(start.minutes) > 0);
  assert.equal(x.performAction(tok).action, 'done');
  assert.equal(x.taskPushActions('https://x.test', t.id).length, 3);
});

test('local foods seed is idempotent; rescue silences pushes', async () => {
  assert.ok(x.seedLocalFoods().added > 10);
  assert.equal(x.seedLocalFoods().added, 0);
  const at = new Date();
  await x.rescue(at);
  assert.equal(x.pushSilenced(), true);
  await x.endRescue();
  assert.equal(x.pushSilenced(), false);
  const c = x.closeDay({ first_thing: 'Open the proposal doc' });
  assert.ok(c);
});

test('rescue Zero covers one life-day: records who set it, ends at 04:00 unless kept', async () => {
  const ms = await import('../src/modeState.ts');
  const { kvGet, kvSet } = await import('../src/db.ts');
  kvSet('mode', 'Normal');
  const at = new Date('2027-03-10T15:00:00Z');
  const r = await x.rescue(at) as Record<string, any>;
  assert.equal(r.mode, 'Zero');
  assert.equal(r.after, 'Normal');
  assert.equal(Date.parse(r.ends_at), Date.parse('2027-03-11T04:00:00Z'));
  assert.ok(!r.next || r.next.minutes <= 10);
  assert.equal(ms.modeSet()?.by, 'rescue');
  assert.equal(ms.rescueInfo(at)?.active, true);
  // Tonight's run plans tomorrow in the mode after Rescue, not Zero.
  assert.equal(ms.modeForDay('2027-03-10', 'Zero', at), 'Zero');
  assert.equal(ms.modeForDay('2027-03-11', 'Zero', at), 'Normal');
  // Before 04:00 it is still the rescue day.
  assert.equal(await ms.expireRescueMode(new Date('2027-03-11T03:30:00Z')), null);
  assert.equal(kvGet('mode'), 'Zero');
  const back = await ms.expireRescueMode(new Date('2027-03-11T04:10:00Z'));
  assert.equal(back?.mode, 'Normal');
  assert.equal(kvGet('mode'), 'Normal');

  // Kept: stays Zero past 04:00.
  await x.rescue(at);
  assert.equal(x.keepRescue().kept, true);
  assert.equal(ms.rescueInfo(at), null);
  assert.equal(await ms.expireRescueMode(new Date('2027-03-12T05:00:00Z')), null);
  assert.equal(kvGet('mode'), 'Zero');
  await x.endRescue();
  assert.equal(ms.modeSet()?.by, 'user');
});
