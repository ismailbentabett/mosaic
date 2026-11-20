import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-food-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const f = await import('../src/modules/food/store.ts');
const b = await import('../src/modules/body/store.ts');
const round1 = (n: number) => Math.round(n * 10) / 10;

test('sanity flags bad rows, never hides them', () => {
  assert.deepEqual(f.sanity({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 }), []);
  assert.ok(f.sanity({ kcal: 950, fat: 100 }).includes('kcal_over_900'));
  assert.ok(f.sanity({ kcal: 100, protein: 30, carbs: 30 }).includes('kcal_macro_mismatch'));
  assert.ok(f.sanity({ kcal: 300, protein: 60, carbs: 50 }).includes('macros_over_100g'));
});

test('foods: add, idempotent source rows, search, barcode', async () => {
  const chicken = f.addFood({ source: 'ciqual', source_ref: 'c-1', name: 'Chicken breast, cooked', kcal: 165, protein: 31, fat: 3.6, servings: [{ label: 'piece', grams: 120 }] });
  assert.equal(f.addFood({ source: 'ciqual', source_ref: 'c-1', name: 'x', kcal: 1 }).id, chicken.id);
  f.addFood({ source: 'usda', source_ref: 'u-1', name: 'Rice, white, cooked', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 });
  assert.equal(f.searchFoods('rice')[0].name, 'Rice, white, cooked');
  assert.equal(f.searchFoods('ch')[0].name, 'Chicken breast, cooked'); // short query uses LIKE
  assert.equal(code(() => f.addFood({ name: 'x', kcal: -1 })), 'bad_request');

  const fetcher = async (c: string) => c === '3017620422003'
    ? { product_name: 'Nutella', brands: 'Ferrero', nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 } }
    : null;
  const hit = await f.lookupBarcode('3017620422003', fetcher);
  assert.equal(hit.from, 'off');
  assert.equal(hit.food?.name, 'Nutella');
  assert.equal((await f.lookupBarcode('3017620422003', fetcher)).from, 'local');
  assert.equal((await f.lookupBarcode('1234567890123', fetcher)).food, null);
  assert.equal((await f.lookupBarcode('1234567890123', fetcher)).from, 'cache');
  await assert.rejects(f.lookupBarcode('12a', fetcher));
});

test('CSV import is idempotent and counts flags', () => {
  const csv = 'name;kcal;protein;carbs;fat;source_ref\nLentils, cooked;116;9;20;0.4;L1\nWeird;50;40;40;0;W1\n;100;1;1;1;X\nNo kcal;;1;1;1;Y';
  const dry = f.importFoodsCsv(csv, 'ciqual', true);
  assert.equal(dry.added, 2);
  assert.equal(dry.flagged, 1);
  assert.equal(dry.dryRun, true);
  assert.equal(f.importFoodsCsv(csv, 'ciqual').added, 2);
  assert.equal(f.importFoodsCsv(csv, 'ciqual').added, 0);
});

test('logging: grams, serving, recipe, quick add, day view, copy, meals', () => {
  const d = '2026-11-10';
  const a = f.logFood({ id: 'foodlog-0001', day: d, slot: 'lunch', food: 'Rice, white, cooked', grams: 200 });
  assert.equal(a.kcal, 260);
  assert.equal(f.logFood({ id: 'foodlog-0001', day: d, food: 'Rice, white, cooked', grams: 999 }).kcal, 260);
  const p = f.logFood({ day: d, slot: 'lunch', food: 'Chicken breast, cooked', serving: 'piece', qty: 1 });
  assert.equal(p.grams, 120);
  f.logFood({ day: d, slot: 'snacks', name: 'Msemen', kcal: 300 });
  assert.equal(code(() => f.logFood({ day: d, slot: 'brunch', kcal: 1 })), 'bad_request');
  assert.equal(code(() => f.logFood({ day: d, kcal: 20000 })), 'bad_request');
  assert.equal(code(() => f.logFood({ day: d })), 'bad_request');

  const r = f.addRecipe({ name: 'Chicken rice', items: [{ food: 'Rice, white, cooked', grams: 300 }, { food: 'Chicken breast, cooked', grams: 200 }], cooked_g: 400, portions: 2 });
  assert.equal(r.weight_g, 400);
  const pr = f.logFood({ day: d, slot: 'dinner', recipe: 'Chicken rice', portions: 1 });
  assert.equal(pr.grams, 200);
  assert.equal(pr.kcal, round1(r.total.kcal / 2));

  assert.equal(f.addWater(250, d), 250);
  assert.equal(f.addWater(500, d), 750);
  const day = f.foodDay(d);
  assert.equal(day.total.kcal, round1(260 + p.kcal + 300 + pr.kcal));
  assert.equal(day.water_ml, 750);
  assert.equal(day.target, null);

  assert.equal(f.copyMeal(d, '2026-11-11', 'lunch'), 2);
  assert.equal(f.copyMeal(d, '2026-11-11', 'lunch'), 0);
  f.saveMeal('Usual lunch', d, 'lunch');
  assert.equal(f.logMeal('usual lunch', '2026-11-12').length, 2);
});

test('targets floor at 1500; adaptive TDEE needs enough data', () => {
  const t = f.setTargets({ from_day: '2026-11-01', kcal: 1200, protein: 150 });
  assert.equal(t.kcal, 1500);
  assert.equal(t.floored, true);
  assert.equal(f.targetFor('2026-11-20')?.kcal, 1500);

  assert.equal(f.adaptiveTdee('2027-01-01').tdee, null);
  // 14 complete days at 2500 kcal, weight flat → tdee ≈ 2500
  for (let i = 1; i <= 14; i++) {
    const day = `2026-11-${String(i + 14).padStart(2, '0')}`;
    f.logFood({ day, slot: 'lunch', name: 'Day food', kcal: 2500 });
    f.setDayStatus(day, 'complete');
    if (i % 3 === 0) b.logMetric({ day, kind: 'weight', value: 80 });
  }
  b.logMetric({ day: '2026-11-15', kind: 'weight', value: 80 });
  const a = f.adaptiveTdee('2026-11-29');
  assert.equal(a.counted_days, 14);
  assert.ok(a.weigh_ins >= 4);
  assert.equal(a.tdee, 2500);
  const s = f.suggestTarget(-0.5, 1.8, '2026-11-29');
  assert.equal(s.method, 'adaptive');
  assert.ok(s.kcal! < 2500 && s.kcal! >= 1500);
  assert.equal(code(() => f.suggestTarget(-3)), 'bad_request');
});

test('meal slots: one rule', () => {
  const at = (h: number, m = 0) => h * 60 + m;
  assert.equal(f.slotAt(at(3)), 'snacks');
  assert.equal(f.slotAt(at(4)), 'breakfast');
  assert.equal(f.slotAt(at(11, 59)), 'breakfast');
  assert.equal(f.slotAt(at(12)), 'lunch');
  assert.equal(f.slotAt(at(16)), 'snacks');
  assert.equal(f.slotAt(at(18)), 'dinner');
  assert.equal(f.slotAt(at(21, 59)), 'dinner');
  assert.equal(f.slotAt(at(22)), 'snacks');
  // server clock in UTC
  assert.equal(f.slotFor(new Date('2026-11-10T13:00:00Z')), 'lunch');
  assert.equal(f.slotFor(new Date('2026-11-10T18:30:00Z')), 'dinner');
  assert.ok(Object.keys(f.foodDay('2026-11-03').slots).includes('breakfast'));
});

test('TDEE counts only days marked complete', () => {
  // 12 unmarked 3000 kcal days: never counted
  for (let i = 1; i <= 12; i++) f.logFood({ day: `2027-01-${String(i).padStart(2, '0')}`, slot: 'lunch', name: 'Unmarked', kcal: 3000 });
  for (const d of ['2027-01-02', '2027-01-05', '2027-01-08', '2027-01-11']) b.logMetric({ day: d, kind: 'weight', value: 81 });
  const a = f.adaptiveTdee('2027-01-13');
  assert.equal(a.counted_days, 0);
  assert.equal(a.tdee, null);
  assert.equal(f.setDayStatus('2027-01-01', 'partial').status, 'partial');
  assert.equal(f.adaptiveTdee('2027-01-13').counted_days, 0);
  f.setDayStatus('2027-01-02', 'complete');
  f.setDayStatus('2027-01-03', 'complete');
  assert.equal(f.adaptiveTdee('2027-01-13').counted_days, 2);
  assert.deepEqual(f.setDayStatus('2027-01-03', null), { day: '2027-01-03', status: null });
  assert.equal(f.dayStatus('2027-01-03'), null);
  assert.equal(code(() => f.setDayStatus('2027-01-03', 'nope' as any)), 'bad_request');
});

test('MFP import is idempotent', () => {
  const csv = 'Date,Meal,Calories,Fat (g),Carbohydrates (g),Protein (g)\n2026-09-01,Breakfast,400,10,50,20\n2026-09-01,Dinner,800,30,80,40';
  assert.equal(f.importMfp(csv).added, 2);
  assert.equal(f.importMfp(csv).added, 0);
  assert.equal(f.foodDay('2026-09-01').total.kcal, 1200);
});
