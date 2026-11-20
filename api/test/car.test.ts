import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-car-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const car = await import('../src/modules/car/store.ts');
const money = await import('../src/modules/money/store.ts');
const { lifeToday, addDays } = await import('../src/time.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code ?? e.message; } };
const msg = (fn: () => unknown) => { try { fn(); return ''; } catch (e: any) { return String(e.message); } };

const BANNED = /streak|points?\b|missed|overdue|failed|behind|lazy|should have/i;
const today = lifeToday();
const ago = (n: number) => addDays(today, -n);

test('glance is null with nothing saved, overview says no car', () => {
  assert.equal(car.carGlance(today), null);
  const o = car.carOverview(undefined, today);
  assert.equal(o.car, null);
  assert.match(car.overviewText(undefined, today), /No car saved yet/);
});

test('first car becomes the main car; duplicate names are rejected; add is idempotent by id', () => {
  money.addAccount({ name: 'Wallet', currency: 'USD', track: 'personal' });
  const a = car.addCar({ id: 'car-aaaa', make: 'Renault', model: 'Clio', year: 2014, start_km: 120000, fuel: 'Diesel' });
  assert.equal(a.name, 'Renault Clio');
  assert.equal(a.fuel, 'diesel');
  assert.equal(car.defaultCar()?.id, 'car-aaaa');
  assert.deepEqual(car.addCar({ id: 'car-aaaa', name: 'Other' }).name, 'Renault Clio');
  assert.notEqual(code(() => car.addCar({ name: 'renault clio' })), 'ok');
  const b = car.addCar({ id: 'car-bbbb', name: 'Old Polo', status: 'sold' });
  assert.equal(car.defaultCar()?.id, 'car-aaaa', 'second car does not take the main slot');
  assert.equal(car.listCars(false).some((c) => c.id === b.id), false, 'sold cars hidden');
  assert.notEqual(code(() => car.addCar({ name: 'X', fuel: 'kerosene' })), 'ok');
});

test('odometer: current km is the highest reading; readings that go backwards are rejected', () => {
  car.logKm({ day: ago(60), km: 121000 });
  car.logKm({ day: ago(30), km: 122500 });
  assert.equal(car.currentKm(car.defaultCar()!), 122500);
  assert.notEqual(code(() => car.logKm({ day: ago(10), km: 121500 })), 'ok', 'below an earlier reading');
  assert.notEqual(code(() => car.logKm({ day: ago(90), km: 130000 })), 'ok', 'above a later reading');
});

test('fuel: L/100 km between full fills, money record once per id, delete drops it', () => {
  const f1 = car.addFuel({ id: 'fill-0001', day: ago(20), km: 123000, litres: 40, amount: 1800 });
  assert.ok(f1.record_id, 'money record saved');
  assert.equal(f1.money_note, null);
  car.addFuel({ id: 'fill-0002', day: ago(12), km: 123300, litres: 15, full: false, price_per_l: 45 });
  const f3 = car.addFuel({ id: 'fill-0003', day: ago(5), km: 123800, amount: 1350, price_per_l: 45 });
  assert.equal(f3.litres, 30);
  // (15 + 30) L over 800 km = 5.6 L/100
  const list = car.listFuel();
  assert.equal(list[0].id, 'fill-0003');
  assert.equal(list[0].l_per_100, 5.6);
  assert.equal(list[0].price_per_l, 45);
  assert.equal(list.find((r) => r.id === 'fill-0002')?.l_per_100, null);
  const again = car.addFuel({ id: 'fill-0001', day: ago(20), km: 123000, litres: 40, amount: 1800 });
  assert.equal(again.record_id, f1.record_id, 'replay is idempotent');
  const recs = money.listRecords({ limit: 500 }).filter((r: any) => r.labels?.includes?.('car') || String(r.note ?? '').includes('Fuel'));
  assert.equal(recs.filter((r: any) => r.id === f1.record_id).length, 1);
  assert.ok(money.getRecord(String(f1.record_id)));
  assert.notEqual(code(() => car.addFuel({ day: today, km: 124000 })), 'ok', 'needs litres or an amount');
  const tmp = car.addFuel({ id: 'fill-temp', day: ago(4), km: 123900, litres: 5, amount: 225 });
  car.deleteFuel('fill-temp');
  assert.ok((money.getRecord(String(tmp.record_id)) as any)?.deleted_at, 'money record removed');
  assert.equal(car.listFuel().some((r) => r.id === 'fill-temp'), false);
  const o = car.carOverview(undefined, today);
  assert.equal(o.economy?.last, 5.6);
});

test('service: next due is filled from the usual gaps; states due / soon / later', () => {
  const oil = car.addService({ id: 'svc-oil1', day: ago(300), km: 114000, kind: 'oil', amount: 4500 });
  assert.equal(oil.title, car.SERVICE_INTERVALS.oil.label);
  assert.equal(oil.next_km, 124000);
  assert.ok(String(oil.next_day) > today, '12 months after the service');
  const brakes = car.addService({ id: 'svc-brakes', day: ago(10), km: 123700, kind: 'brakes' });
  assert.equal(brakes.next_km, 153700);
  assert.notEqual(code(() => car.addService({ day: ago(9), km: 123710, kind: 'tyres', next_km: 123000 })), 'ok');
  const custom = car.addService({ id: 'svc-wash1', day: ago(3), kind: 'wash', title: 'Wash', next_day: addDays(today, 3) });
  assert.equal(custom.next_day, addDays(today, 3));
  const due = car.carDue(undefined, today);
  const byId = Object.fromEntries(due.map((d) => [d.id, d]));
  // current km is 123800 (last fill), so oil at 124000 is 200 km away
  assert.equal(byId['svc-oil1'].state, 'soon');
  assert.equal(byId['svc-brakes'].state, 'later');
  assert.equal(byId['svc-wash1'].state, 'soon');
  assert.match(byId['svc-wash1'].line, /in 3 days/);
  assert.equal(due[0].state === 'later', false, 'nearest first');
  for (const d of due) assert.doesNotMatch(d.line, BANNED);
});

test('service past its km reads as "past", never as overdue', () => {
  car.addService({ id: 'svc-filters', day: ago(400), km: 105000, kind: 'filters' });
  const d = car.carDue(undefined, today).find((x) => x.id === 'svc-filters')!;
  assert.equal(d.state, 'due');
  assert.match(d.line, /past/);
  assert.doesNotMatch(d.line, BANNED);
});

test('papers: expiry drives due; renew keeps history and shows only the new one', () => {
  const ins = car.addPaper({ id: 'paper-ins1', kind: 'insurance', expires_on: addDays(today, 12), amount: 9000, paid_on: ago(353) });
  assert.equal(ins.name, car.PAPER_LABEL.insurance);
  assert.ok(ins.record_id);
  let d = car.carDue(undefined, today).find((x) => x.id === 'paper-ins1')!;
  assert.equal(d.state, 'soon');
  const next = car.renewPaper('paper-ins1', { expires_on: addDays(today, 377), amount: 9500, new_id: 'paper-ins2' });
  assert.equal(next.id, 'paper-ins2');
  const current = car.listPapers();
  assert.deepEqual(current.filter((p) => p.kind === 'insurance').map((p) => p.id), ['paper-ins2']);
  assert.equal(car.listPapers(undefined, true).filter((p) => p.kind === 'insurance').length, 2);
  d = car.carDue(undefined, today).find((x) => x.id === 'paper-ins2')!;
  assert.equal(d.state, 'later');
  assert.equal(car.carDue(undefined, today).some((x) => x.id === 'paper-ins1'), false);
  const reg = car.addPaper({ kind: 'registration', expires_on: ago(2), log_money: false });
  assert.equal(reg.record_id, null);
  const r = car.carDue(undefined, today).find((x) => x.id === reg.id)!;
  assert.equal(r.state, 'due');
  assert.match(r.line, /past date/);
  assert.notEqual(code(() => car.addPaper({ kind: 'passport' })), 'ok');
});

test('account and card numbers are refused in free text', () => {
  const m = msg(() => car.addPaper({ kind: 'insurance', note: 'policy 1234 5678 9012 3456' }));
  assert.match(m, /password manager/);
  assert.notEqual(code(() => car.addFuel({ litres: 10, note: '0012-3456-7890-12' })), 'ok');
  assert.equal(code(() => car.addPaper({ kind: 'vignette', where_kept: 'glovebox' })), 'ok');
});

test('listings: bad url refused, same url returns the existing row, open count on the glance', () => {
  assert.match(msg(() => car.addListing({ title: 'C200 2012', url: 'ouedkniss.com/x' })), /http/);
  const l = car.addListing({ title: 'Peugeot 208 2012', year: 2012, km: 180000, price: 2900000, url: 'https://example.com/c200', place: 'Setif' });
  const dup = car.addListing({ title: 'again', url: 'https://example.com/c200' }) as any;
  assert.equal(dup.id, l.id);
  assert.equal(dup.existing, true);
  car.addListing({ title: 'Peugeot 308 2014', price: 3400000, status: 'contacted' });
  car.addListing({ title: 'C180 rejected', price: 2000000, status: 'rejected' });
  assert.equal(car.listListings('open').length, 2);
  car.updateListing(String(l.id), { status: 'seen', price: 2850000 });
  const o = car.carOverview(undefined, today);
  assert.equal(o.buying.open, 2);
  assert.equal(o.buying.cheapest, 2850000);
  assert.notEqual(code(() => car.updateListing(String(l.id), { status: 'maybe' })), 'ok');
});

test('overview + glance: spend this month, due counts, copy stays calm', () => {
  const o = car.carOverview(undefined, today) as any;
  assert.equal(o.car.id, 'car-aaaa');
  assert.ok(o.car.km >= 123800);
  assert.equal(o.monthly.length, 6);
  assert.ok(o.last_fill && o.last_fill.id === 'fill-0003');
  const g = car.carGlance(today)!;
  assert.equal(g.car, 'Renault Clio');
  assert.ok(g.due >= 2);
  assert.ok(g.soon >= 1);
  assert.ok(g.next);
  assert.equal(g.listings, 2);
  const txt = car.overviewText(undefined, today);
  assert.match(txt, /Renault Clio/);
  assert.match(txt, /Coming up/);
  assert.doesNotMatch(txt, BANNED);
  assert.doesNotMatch(txt, /!/);
});

test('deleting a car hides it and moves the main slot', () => {
  const c = car.addCar({ id: 'car-cccc', name: 'Peugeot 308', status: 'wanted' });
  car.updateCar('car-cccc', { is_default: true });
  assert.equal(car.defaultCar()?.id, 'car-cccc');
  car.deleteCar('car-cccc');
  assert.notEqual(car.defaultCar()?.id, 'car-cccc');
  assert.ok(!car.findCar(String(c.id)));
});
