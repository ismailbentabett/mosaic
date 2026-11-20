import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-thrift-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const t = await import('../src/modules/thrift/store.ts');
const m = await import('../src/modules/money/store.ts');
const f = await import('../src/modules/food/store.ts');
const g = await import('../src/modules/gym/store.ts');
const p = await import('../src/modules/profile/store.ts');
const x = await import('../src/modules/extras/store.ts');
const { addDays } = await import('../src/time.ts');

// ---------- 1. recipe → shopping ----------
test('recipe to shopping: scale, merge, skip, errors', () => {
  f.addFood({ name: 'Rice, white', kcal: 130 });
  f.addFood({ name: 'Chicken breast', kcal: 165 });
  f.addFood({ name: 'Tomato', kcal: 18 });
  const r = f.addRecipe({ name: 'Chicken rice', portions: 2, items: [
    { food: 'Rice, white', grams: 300 }, { food: 'Chicken breast', grams: 200 }, { food: 'Tomato', grams: 50 }, { food: 'Tomato', grams: 50 }] });

  const a = t.recipeToShopping(r.id, 4, { days: 3, list: 'Thrift' }); // factor 6
  assert.equal(a.factor, 6);
  assert.equal(a.added.length, 3);
  const rows = m.listShopping('Thrift');
  assert.equal(rows.find((s) => s.name === 'Rice, white')!.qty, '1.8 kg');
  assert.equal(rows.find((s) => s.name === 'Tomato')!.qty, '600 g'); // duplicate food lines combined

  const b = t.recipeToShopping('Chicken rice', 1, { list: 'Thrift', skip: ['tomato'] }); // factor 0.5
  assert.equal(b.added.length, 0);
  assert.equal(b.merged.length, 2);
  assert.deepEqual(b.skipped, ['Tomato']);
  const after = m.listShopping('Thrift');
  assert.equal(after.length, 3); // merged, no duplicates
  assert.equal(after.find((s) => s.name === 'Rice, white')!.qty, '1.95 kg');
  assert.equal(after.find((s) => s.name === 'Chicken breast')!.qty, '1.3 kg');

  // non-gram qty on an open item is kept and appended
  m.addShopping('Rice, white', 'Other', '1 bag');
  const c = t.recipeToShopping(r.id, 2, { list: 'Other' });
  assert.equal(m.listShopping('Other').find((s) => s.name === 'Rice, white')!.qty, '1 bag + 300 g');
  assert.equal(c.merged.length, 1);

  // done items are not merged into
  const done = m.listShopping('Other').find((s) => s.name === 'Rice, white')!;
  m.toggleShopping(String(done.id), true);
  assert.equal(t.recipeToShopping(r.id, 2, { list: 'Other' }).added.length, 1); // rice new, chicken+tomato merged

  assert.equal(code(() => t.recipeToShopping(r.id, 0)), 'bad_request');
  assert.equal(code(() => t.recipeToShopping(r.id, 2, { days: 0 })), 'bad_request');
  assert.equal(code(() => t.recipeToShopping(r.id, 2, { days: 1.5 })), 'bad_request');
  assert.equal(code(() => t.recipeToShopping('nope', 2)), 'not_found');
});

// ---------- 2. rate freshness ----------
test('rate ask: no rate, stale, dedup, fresh, answer applies once', () => {
  const today = '2026-11-11';
  const first = t.rateFreshnessAsk(today); // no EUR rate at all
  assert.equal(first.queued, true);
  assert.equal(first.latest, null);
  assert.equal(first.key, 'money.rate_eur_per_usd.20261111');
  const again = t.rateFreshnessAsk(today);
  assert.equal(again.queued, false); // dedup
  assert.equal(t.rateFreshnessAsk('2026-11-12').queued, false); // still one open ask
  assert.equal(p.asksNext(20, today).filter((a) => a.key.startsWith(t.RATE_ASK_PREFIX)).length, 1);

  // answer it → EUR rate = 1 / EUR per USD (USD is the base)
  p.asksAnswer(first.key!, 0.8);
  const applied = t.applyRateAnswers();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].currency, 'EUR');
  assert.ok(Math.abs(applied[0].to_usd - 1 / 0.8) < 1e-9);
  assert.equal(t.applyRateAnswers().length, 0); // once only
  // the EUR rate lands on the real answer day; age counts from the newest rate
  const base = String(applied[0].day) > today ? String(applied[0].day) : today;

  // fresh (exactly 7 days old is still fresh)
  const fresh = t.rateFreshnessAsk(addDays(base, 7));
  assert.equal(fresh.queued, false);
  assert.equal(fresh.age_days, 7);
  assert.equal(fresh.key, null);
  // stale at 8 days → new ask (previous was answered)
  const stale = t.rateFreshnessAsk(addDays(base, 8));
  assert.equal(stale.queued, true);
  assert.equal(stale.age_days, 8);
  assert.equal(t.rateFreshnessAsk(addDays(base, 9)).queued, false);

  // implausible answer is ignored, but marked as seen
  p.asksAnswer(stale.key!, 5);
  assert.equal(t.applyRateAnswers().length, 0);
  assert.equal(code(() => t.rateFreshnessAsk('11/11/2026')), 'bad_request');
});

// ---------- 3. recurring costs ----------
test('recurring costs: chains, tolerance, Claude excluded, planned, business ignored', () => {
  const empty = t.recurringCosts({ from: '2020-01-01', to: '2020-12-31' });
  assert.equal(empty.count, 0);
  assert.equal(empty.monthly_usd, 0);
  assert.match(empty.message, /Nothing looks recurring/);

  m.addAccount({ id: 'acct-usd-p', name: 'Wise USD', currency: 'USD', track: 'personal' });
  m.addAccount({ id: 'acct-usd-b', name: 'Biz USD', currency: 'USD', track: 'business' });
  const days = ['2025-01-05', '2025-02-04', '2025-03-06', '2025-04-05'];
  days.forEach((d, i) => m.addRecord({ account: 'acct-usd-p', amount: [10, 10.5, 9.5, 11] [i], payee: 'Netflix', day: d }));
  days.forEach((d) => m.addRecord({ account: 'acct-usd-p', amount: 20, payee: 'Claude Pro', day: d }));
  days.forEach((d) => m.addRecord({ account: 'acct-usd-p', amount: 5, note: 'anthropic api 2025', day: d }));
  days.forEach((d) => m.addRecord({ account: 'acct-usd-b', amount: 30, payee: 'Hosting', day: d })); // business track
  // irregular: same payee but amounts way off / gaps too short
  ['2025-01-01', '2025-01-10', '2025-01-20'].forEach((d) => m.addRecord({ account: 'acct-usd-p', amount: 8, payee: 'Cafe', day: d }));
  ['2025-01-01', '2025-02-01', '2025-03-01'].forEach((d, i) => m.addRecord({ account: 'acct-usd-p', amount: [10, 30, 10][i], payee: 'Gift shop', day: d }));
  // note-based grouping, digits stripped
  ['2025-05-01', '2025-05-31', '2025-06-30'].forEach((d, i) => m.addRecord({ account: 'acct-usd-p', amount: 3, note: `Phone top-up #${i + 1}`, day: d }));

  const out = t.recurringCosts({ from: '2025-01-01', to: '2025-12-31' });
  const names = out.items.map((i) => i.name);
  assert.ok(names.includes('Netflix'));
  assert.ok(names.some((n) => /phone top-up/i.test(n)));
  assert.ok(!names.some((n) => /claude|anthropic/i.test(n)));
  assert.ok(!names.includes('Hosting'));
  assert.ok(!names.includes('Cafe'));
  assert.ok(!names.includes('Gift shop')); // 30 is outside ±15%; only 2 left
  const nf = out.items.find((i) => i.name === 'Netflix')!;
  assert.equal(nf.occurrences, 4);
  assert.equal(nf.source, 'records');
  assert.ok(nf.monthly_usd > 9 && nf.monthly_usd < 12);
  assert.ok(!/over|missed|budget/i.test(out.message));

  // planned payments: personal counted, Claude and business left out
  m.addPlanned({ id: 'plan-gym', name: 'Gym membership', template: { account: 'acct-usd-p', amount: 15 }, recur: { freq: 'monthly' }, next_due: '2025-07-01' });
  m.addPlanned({ name: 'Claude Max', template: { account: 'acct-usd-p', amount: 100 }, recur: { freq: 'monthly' }, next_due: '2025-07-01' });
  m.addPlanned({ name: 'Domains', template: { account: 'acct-usd-b', amount: 12 }, recur: { freq: 'yearly' }, next_due: '2025-07-01' });
  m.addPlanned({ name: 'Water', template: { account: 'acct-usd-p', amount: 2 }, recur: { freq: 'weekly' }, next_due: '2025-07-01' });
  const out2 = t.recurringCosts({ from: '2025-01-01', to: '2025-12-31', today: '2025-07-01' });
  const gymP = out2.items.find((i) => i.planned_id === 'plan-gym')!;
  assert.equal(gymP.monthly_usd, 15);
  assert.ok(!out2.items.some((i) => /claude/i.test(i.name) || i.name === 'Domains'));
  assert.equal(out2.items.find((i) => i.name === 'Water')!.monthly_usd, 8.7);
  // records posted by a listed planned payment are not counted twice
  ['2025-08-01', '2025-09-01', '2025-10-01'].forEach((d) => m.addRecord({ account: 'acct-usd-p', amount: 15, payee: 'Gym', day: d, planned_id: 'plan-gym' }));
  const out3 = t.recurringCosts({ from: '2025-01-01', to: '2025-12-31', today: '2025-07-01' });
  assert.equal(out3.items.filter((i) => /gym/i.test(i.name)).length, 1);
  assert.equal(out3.monthly_usd, round2(out3.items.reduce((a, b) => a + b.monthly_usd, 0)));
});
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- 4. skipped buys ----------
test('skipped buys: log, idempotent, wish dropped, monthly USD, never in balances', () => {
  assert.deepEqual(t.skippedSummary({ from: '2030-01-01', to: '2030-12-31' }), { months: [], total_usd: 0, count: 0 });
  m.setRate('EUR', 1.25, '2026-10-01');
  const before = m.listAccounts().map((a) => [a.id, a.balance]);
  const s1 = t.logSkippedBuy({ id: 'skip-0000001', name: 'Sneakers', amount: 60, currency: 'EUR', day: '2026-10-03' });
  assert.equal(s1.usd, 75);
  assert.equal(t.logSkippedBuy({ id: 'skip-0000001', name: 'Other', amount: 1 }).name, 'Sneakers'); // same id = one row
  t.logSkippedBuy({ name: 'Coffee', amount: 4, currency: 'USD', day: '2026-10-20' });
  t.logSkippedBuy({ name: 'Book', amount: 12, currency: 'EUR', day: '2026-11-02' });
  const wish = x.addWish({ name: 'Headphones', price: 120, currency: 'EUR' });
  const s4 = t.logSkippedBuy({ wish_id: wish.id, day: '2026-11-05' });
  assert.equal(s4.name, 'Headphones');
  assert.equal(x.listWishlist('all').find((w) => w.id === wish.id)!.status, 'dropped');

  const sum = t.skippedSummary({ from: '2026-10-01', to: '2026-11-30' });
  assert.equal(sum.months.length, 2);
  assert.deepEqual(sum.months[0], { month: '2026-10', usd: 79, count: 2 });
  assert.equal(sum.count, 4);
  assert.equal(t.listSkippedBuys({ from: '2026-11-01' }).length, 2);
  // balances unchanged, no income records
  assert.deepEqual(m.listAccounts().map((a) => [a.id, a.balance]), before);

  t.deleteSkippedBuy(s1.id);
  assert.equal(t.skippedSummary({ from: '2026-10-01', to: '2026-10-31' }).total_usd, 4);
  assert.equal(code(() => t.deleteSkippedBuy(s1.id)), 'not_found');
  assert.equal(code(() => t.logSkippedBuy({ name: 'x', amount: 0 })), 'bad_request');
  assert.equal(code(() => t.logSkippedBuy({ name: '', amount: 5 })), 'bad_request');
  assert.equal(code(() => t.logSkippedBuy({ name: 'x', amount: 5, currency: 'XYZ' })), 'bad_request');
  assert.equal(code(() => t.logSkippedBuy({ name: 'card 4111 1111 1111 1111', amount: 5 })), 'bad_request');
  assert.equal(code(() => t.logSkippedBuy({ wish_id: 'missing-wish' })), 'not_found');
});

// ---------- 5. for whom ----------
test('for-whom: tag, retag, untagged, business refused, summary', () => {
  m.addAccount({ id: 'acct-eur-p', name: 'EUR cash', currency: 'EUR', track: 'personal' });
  m.addAccount({ id: 'acct-eur-b', name: 'EUR biz', currency: 'EUR', track: 'business' });
  m.setRate('EUR', 1.1, '2026-09-01');
  const a = m.addRecord({ account: 'acct-eur-p', amount: 10, day: '2026-09-02', rate_to_usd: 1.1 });
  const b = m.addRecord({ account: 'acct-eur-p', amount: 20, day: '2026-09-03', rate_to_usd: 1.1 });
  const c = m.addRecord({ account: 'acct-eur-p', amount: 30, day: '2026-09-04', rate_to_usd: 1.1 });
  const biz = m.addRecord({ account: 'acct-eur-b', amount: 50, day: '2026-09-04', rate_to_usd: 1.1 });
  const inc = m.addRecord({ account: 'acct-eur-p', kind: 'income', amount: 50, day: '2026-09-04', rate_to_usd: 1.1 });

  const empty = t.spendByWho({ from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(empty.by_who, []);
  assert.equal(empty.total_usd, 0);

  assert.deepEqual(t.setRecordFor(String(a.id), ' Family '), { record_id: a.id, who: 'family' });
  t.setRecordFor(String(b.id), 'gift');
  t.setRecordFor(String(b.id), 'Amina'); // retag replaces
  assert.equal(t.getRecordFor(String(b.id)), 'amina');
  const s = t.spendByWho({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(s.by_who.map((w) => w.who), ['amina', 'family']);
  assert.equal(s.by_who[0].usd, 22);
  assert.equal(s.untagged_usd, 33);
  assert.equal(s.total_usd, 66); // business and income left out

  t.clearRecordFor(String(a.id));
  assert.equal(t.getRecordFor(String(a.id)), null);
  assert.equal(t.spendByWho({ from: '2026-09-01', to: '2026-09-30' }).untagged_usd, 44);
  t.setRecordFor(String(a.id), 'self'); // re-tag after clear
  assert.equal(t.getRecordFor(String(a.id)), 'self');

  assert.equal(code(() => t.setRecordFor(String(biz.id), 'self')), 'bad_request');
  assert.equal(code(() => t.setRecordFor(String(inc.id), 'self')), 'bad_request');
  assert.equal(code(() => t.setRecordFor(String(c.id), '  ')), 'bad_request');
  assert.equal(code(() => t.setRecordFor('missing-record', 'self')), 'not_found');
  assert.equal(code(() => t.spendByWho({ from: 'x', to: '2026-09-30' })), 'bad_request');
});

// ---------- 6. shop grouping ----------
test('shop grouping: keywords, default, override persists and clears', () => {
  assert.deepEqual(t.shopGroups('Empty list'), []);
  assert.equal(t.storeFor('Tomatoes').store, 'market');
  assert.equal(t.storeFor('Pommes de terre').store, 'market');
  assert.equal(t.storeFor('Baguette').store, 'boulangerie');
  assert.equal(t.storeFor('Doliprane 1000').store, 'pharmacie');
  assert.equal(t.storeFor('Eau de Javel').store, 'droguerie');
  assert.equal(t.storeFor('Poulet').store, 'boucherie');
  assert.equal(t.storeFor('Pasta').store, 'épicerie');
  assert.equal(t.storeFor('Pasta').how, 'default');
  assert.equal(t.storeFor('Pineapple').store, 'épicerie'); // "apple" inside a word does not match

  for (const n of ['Pasta', 'Onions', 'Pain', 'Savon', 'Vitamine C', 'Lentils']) m.addShopping(n, 'Week');
  const groups = t.shopGroups('Week');
  assert.deepEqual(groups.map((gr) => gr.store), ['market', 'boulangerie', 'épicerie', 'droguerie', 'pharmacie']);
  assert.equal(groups.find((gr) => gr.store === 'épicerie')!.count, 2);

  t.setShopOverride('Lentils', 'Market');
  t.setShopOverride('lentils', 'market'); // same normalised key, one row
  assert.equal(t.listShopOverrides().length, 1);
  assert.deepEqual(t.storeFor('LENTILS'), { store: 'market', how: 'override' });
  m.addShopping('Lentils', 'Next week'); // remembered for future items
  assert.equal(t.shopGroups('Next week')[0].store, 'market');
  t.setShopOverride('Pasta', 'Corner Shop'); // custom store sorts after known ones
  assert.equal(t.shopGroups('Week').at(-1)!.store, 'corner shop');

  assert.equal(t.clearShopOverride('Lentils').store, 'épicerie');
  assert.equal(t.listShopOverrides().length, 1);
  t.setShopOverride('Lentils', 'boucherie'); // revive after clear
  assert.equal(t.storeFor('Lentils').store, 'boucherie');
  assert.equal(code(() => t.setShopOverride('', 'market')), 'bad_request');
  assert.equal(code(() => t.setShopOverride('Rice', '')), 'bad_request');
});

// ---------- 7. gym notes ----------
test('gym carry-forward: last finished workout notes, next-time note shown then acked', () => {
  g.addExercise({ name: 'Bench Press' });
  g.addExercise({ name: 'Plank', kind: 'time' });
  const none = t.gymCarryForward('Bench Press');
  assert.equal(none.last_day, null);
  assert.deepEqual(none.set_notes, []);
  assert.equal(none.next_time, null);

  const w1 = g.startWorkout({ at: '2026-11-02T19:30:00Z' });
  g.logSet({ workout_id: w1.id, exercise: 'Bench Press', weight: 50, reps: 10, note: 'elbows in', at: '2026-11-02T19:35:00Z' });
  g.logSet({ workout_id: w1.id, exercise: 'Bench Press', weight: 50, reps: 10, note: 'elbows in', at: '2026-11-02T19:38:00Z' });
  g.logSet({ workout_id: w1.id, exercise: 'Bench Press', weight: 52.5, reps: 8, note: 'felt heavy', at: '2026-11-02T19:41:00Z' });
  g.finishWorkout(String(w1.id), 'good session', new Date('2026-11-02T20:30:00Z'));
  const w2 = g.startWorkout({ at: '2026-11-04T19:30:00Z' });
  g.logSet({ workout_id: w2.id, exercise: 'Bench Press', weight: 55, reps: 5, note: 'unfinished one', at: '2026-11-04T19:35:00Z' });
  // w2 still active: not used

  const cf = t.gymCarryForward('bench press');
  assert.equal(cf.last_day, '2026-11-02');
  assert.deepEqual(cf.set_notes, ['elbows in', 'felt heavy']);
  assert.equal(cf.workout_note, 'good session');

  // next-time note: ack before shown refused, then shown, then cleared
  t.setNextNote('Bench Press', 'try 55 kg');
  t.setNextNote('Bench Press', 'try 57.5 kg'); // replaces
  assert.equal(code(() => t.ackNextNote('Bench Press')), 'bad_request');
  assert.equal(t.gymCarryForward('Bench Press').next_time!.note, 'try 57.5 kg');
  assert.equal(t.gymCarryForward('Bench Press').next_time!.note, 'try 57.5 kg'); // stays until acked
  assert.deepEqual(t.ackNextNote('Bench Press'), { exercise: 'Bench Press', cleared: true });
  assert.equal(t.gymCarryForward('Bench Press').next_time, null);
  assert.deepEqual(t.ackNextNote('Bench Press'), { exercise: 'Bench Press', cleared: false });
  t.setNextNote('Bench Press', 'x');
  assert.equal(t.setNextNote('Bench Press', '').next_time, null); // empty clears
  assert.equal(t.gymCarryForward('Bench Press').next_time, null);

  assert.equal(t.gymCarryForward('Plank').last_day, null); // never done
  assert.equal(code(() => t.gymCarryForward('Nope')), 'not_found');
  assert.equal(code(() => t.setNextNote('Nope', 'x')), 'not_found');
  assert.equal(code(() => t.ackNextNote('Nope')), 'not_found');
});
