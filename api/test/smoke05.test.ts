// Critique 05 package: documents register (car papers), occasions, people fixes, fund covers, day layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-05-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });

const x = await import('../src/modules/extras/store.ts');
const car = await import('../src/modules/car/store.ts');
const pp = await import('../src/modules/people/store.ts');
const ideas = await import('../src/modules/ideas/store.ts');
const money = await import('../src/modules/money/store.ts');
const { kvSet } = await import('../src/db.ts');
const { lifeToday, addDays } = await import('../src/time.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const BANNED = /streak|missed|overdue|failed|behind|lazy|should have/i;
const SAT = '2026-11-14';

test('documents: nearest threshold only, each once, after once, renewed skipped, new date resets', () => {
  const late = x.addDocument({ name: 'ID card', expires_on: '2026-11-16' }); // 5 days left on Nov 11
  const r1 = x.documentReminders('2026-11-11');
  assert.deepEqual(r1.map((r) => r.threshold), [7]);
  assert.match(r1[0].message, /ends in 5 days\.$/);
  assert.equal(x.documentReminders('2026-11-12').length, 0);
  assert.deepEqual(x.documentReminders('2026-11-16').map((r) => r.threshold), [0]);
  const after = x.documentReminders('2026-11-18');
  assert.deepEqual(after.map((r) => r.threshold), ['after']);
  assert.match(after[0].message, /ended 2 days ago\. Renew when you can\./);
  for (const r of [...r1, ...after]) assert.doesNotMatch(r.message, BANNED);
  assert.equal(x.documentReminders('2026-11-25').length, 0);
  const list = x.listDocuments('2026-11-18');
  assert.equal(list[0].id, late.id);
  assert.equal(list[0].state, 'ended');
  x.updateDocument(late.id, { expires_on: '2027-01-10' }); // 53 days from Nov 18
  assert.deepEqual(x.documentReminders('2026-11-18').map((r) => r.threshold), [60]);
  assert.deepEqual(x.documentReminders('2026-12-11').map((r) => r.threshold), [30]);
  const old = x.addDocument({ name: 'Old licence', expires_on: '2026-11-20', note: 'Renewed' });
  assert.equal(x.documentReminders('2026-11-19').some((r) => r.id === old.id), false);
  assert.equal(x.getDocument(old.id).state, 'renewed');
  const tagged = x.addDocument({ name: 'Spare insurance', car_id: 'car-x', tags: ['Papers'] });
  assert.deepEqual(tagged.tags, ['car', 'papers']);
  assert.deepEqual(x.listDocuments('2026-11-18', { car_id: 'car-x' }).map((d) => d.id), [tagged.id]);
  assert.ok(x.listDocuments('2026-11-18', { tag: 'car' }).some((d) => d.id === tagged.id));
  assert.equal(x.addDocument({ id: tagged.id, name: 'Again' }).name, 'Spare insurance'); // idempotent by id
  assert.equal(x.docLine('Passport', 1), 'Passport: ends tomorrow');
  for (const id of [late.id, old.id, tagged.id]) x.deleteDocument(id);
});

test('car papers live in the documents register and push like any document', () => {
  const today = lifeToday();
  car.addCar({ name: 'Test car' } as never);
  const p = car.addPaper({ id: 'paper-tech1', kind: 'technical', expires_on: addDays(today, 6), log_money: false });
  const d = x.listDocuments(today, { tag: 'car' }).find((r) => r.id === p.id)!;
  assert.ok(d, 'paper is in documents');
  assert.ok(d.car_id);
  const rem = x.documentReminders(today).find((r) => r.id === p.id)!;
  assert.equal(rem.threshold, 7);
  assert.equal(rem.car_id, d.car_id);
});

test('fund covers: share of the cheapest listing in USD', () => {
  const today = lifeToday();
  money.setRate('EUR', 1.1, today); // 1 EUR = 1.10 USD
  const f = car.fundCovers({ current: 1000, unit: 'EUR' }, 2200, today)!;
  assert.equal(f.pct, 50);
  assert.equal(f.fund_usd, 1100);
  assert.equal(f.line, 'Fund covers 50% of the cheapest listing');
  assert.equal(car.fundCovers(null, 2200, today), null);
  assert.equal(car.fundCovers({ current: 1000, unit: 'USD' }, null, today), null);
});

test('people: screen view ignores Saturday quiet, phone kept, first nudge staggered', () => {
  const a = pp.addPerson({ name: 'Cousin Walid', relation: 'family', cadence_days: 10, last_contact: '2026-11-01', phone: '+213 555 12 34 56' });
  assert.equal(pp.findPerson(a.id).phone, '+213 555 12 34 56');
  assert.equal(code(() => pp.addPerson({ name: 'Bad phone', phone: 'call me' })), 'bad_request');
  assert.deepEqual(pp.peopleDue(SAT), []);
  const s = pp.peopleDue(SAT, true).find((p) => p.id === a.id)!;
  assert.equal(s.phone, '+213 555 12 34 56');
  pp.addPromise({ who: 'Walid', what: 'Send the photos', due: SAT });
  assert.deepEqual(pp.promisesSoon(SAT), []);
  assert.equal(pp.promisesSoon(SAT, true).length, 1);
  assert.equal(pp.promisesSoon(SAT, true)[0].when, 'today');
  for (const id of ['p1', 'p2', 'p3']) {
    const off = pp.firstDueOffset(id, 14);
    assert.ok(off >= 1 && off <= 14);
    assert.equal(pp.firstDueOffset(id, 14), off);
  }
  const offs = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id) => pp.firstDueOffset(id, 14)));
  assert.ok(offs.size > 1, 'first nudges are spread out');
  assert.equal(pp.promiseWhen(-2, '2026-11-09'), 'from Mon 9 Nov');
});

test('occasions: a yearly date shows in occasionsSoon with years counted', () => {
  const o = pp.addOccasion({ name: 'Wedding anniversary', kind: 'anniversary', date: '2020-03-10' });
  assert.equal(o.md, '03-10');
  const soon = pp.occasionsSoon('2027-03-01', 14).find((r) => r.id === o.id)!;
  assert.equal(soon.date, '2027-03-10');
  assert.equal(soon.years, 7);
  assert.equal(pp.occasionsSoon('2027-01-01', 14).some((r) => r.id === o.id), false);
});

test('day layouts: Friday, Saturday, Sunday and weekday', () => {
  kvSet('mode', 'Normal');
  assert.equal(ideas.layoutFor('2026-11-13').kind, 'friday');
  assert.equal(ideas.layoutFor('2026-11-13').blocks.find((b) => b.block === '🛠️ Project work')!.from, '14:10');
  assert.equal(ideas.layoutFor('2026-11-14').kind, 'rest');
  assert.equal(ideas.layoutFor('2026-11-15').kind, 'sunday');
  assert.equal(ideas.layoutFor('2026-11-16').kind, 'weekday');
});
