// Mock /api/v2/car (shapes from api/src/modules/car/store.ts). Mock only: loaded through mock.ts behind MOCK.
import type { Car, CarFund, CarGlance, CarOverview, DueItem, Fill, KmReading, Listing, Paper, ServiceJob, Spend } from '../features/car/client';
import { addDays, bad, created, daysBetween, idOf, iso, match, notFound, ok, optNum, round, str, today, type Ctx, type Res } from './util';

void iso;

const INTERVALS: Record<string, { km?: number; months?: number; label: string }> = {
  oil: { km: 10000, months: 12, label: 'Oil change' },
  filters: { km: 20000, months: 24, label: 'Filters' },
  tyres: { km: 40000, months: 48, label: 'Tyres' },
  brakes: { km: 30000, label: 'Brakes' },
  battery: { months: 48, label: 'Battery' },
  timing_belt: { km: 90000, months: 60, label: 'Timing belt' },
  inspection: { months: 12, label: 'Inspection' },
  wash: { label: 'Wash' },
  repair: { label: 'Repair' },
  other: { label: 'Other' },
};
const PAPER_LABELS: Record<string, string> = {
  insurance: 'Insurance', registration: 'Registration (carte grise)', technical: 'Technical check (contrôle technique)',
  vignette: 'Vignette', licence: 'Driving licence', other: 'Other paper',
};

const d0 = today();
const ago = (n: number) => addDays(d0, -n);
const addMonths = (day: string, m: number) => addDays(day, Math.round(m * 30.44));

let cars: Car[] = [
  {
    id: 'car_clio', name: 'Renault Clio', make: 'Renault', model: 'Clio', year: 2014, plate: null, fuel: 'diesel', tank_l: 45,
    status: 'owned', bought_on: null, bought_price: null, currency: 'USD', start_km: 118000, note: null, is_default: true,
  },
];
let kmRows: KmReading[] = [
  { id: 'km_1', car_id: 'car_clio', day: ago(95), km: 119400, note: null },
  { id: 'km_2', car_id: 'car_clio', day: ago(40), km: 121900, note: null },
];
let fills: Fill[] = [
  { id: 'fl_1', car_id: 'car_clio', day: ago(52), km: 121200, litres: 38, amount: 61, currency: 'USD', full: true, station: 'Shell Main St', note: null, record_id: 'r1' },
  { id: 'fl_2', car_id: 'car_clio', day: ago(33), km: 122050, litres: 42, amount: 67, currency: 'USD', full: true, station: 'BP Ring Road', note: null, record_id: 'r2' },
  { id: 'fl_3', car_id: 'car_clio', day: ago(19), km: 122600, litres: 20, amount: 32, currency: 'USD', full: false, station: null, note: null, record_id: 'r3' },
  { id: 'fl_4', car_id: 'car_clio', day: ago(6), km: 123500, litres: 35.5, amount: 57, currency: 'USD', full: true, station: 'Shell Main St', note: null, record_id: 'r4' },
];
let jobs: ServiceJob[] = [
  { id: 'sv_1', car_id: 'car_clio', day: ago(310), km: 114200, kind: 'oil', title: 'Oil change', amount: 75, currency: 'USD', garage: 'Corner Garage', note: null, next_km: 124200, next_day: addMonths(ago(310), 12), record_id: null },
  { id: 'sv_2', car_id: 'car_clio', day: ago(420), km: 103000, kind: 'filters', title: 'Filters', amount: 55, currency: 'USD', garage: null, note: null, next_km: 123000, next_day: addMonths(ago(420), 24), record_id: null },
  { id: 'sv_3', car_id: 'car_clio', day: ago(70), km: 120800, kind: 'brakes', title: 'Front pads', amount: 180, currency: 'USD', garage: 'Corner Garage', note: null, next_km: 150800, next_day: null, record_id: 'r5' },
];
let papers: (Paper & { replaced?: boolean })[] = [
  { id: 'pp_1', car_id: 'car_clio', kind: 'insurance', name: 'Insurance', expires_on: addDays(d0, 18), amount: 620, currency: 'USD', where_kept: 'Glovebox', note: null, paid_on: ago(347), record_id: null },
  { id: 'pp_2', car_id: 'car_clio', kind: 'technical', name: PAPER_LABELS.technical, expires_on: addDays(d0, 140), amount: 45, currency: 'USD', where_kept: 'Glovebox', note: null, paid_on: ago(225), record_id: null },
  { id: 'pp_3', car_id: 'car_clio', kind: 'vignette', name: 'Vignette', expires_on: addDays(d0, 120), amount: 90, currency: 'USD', where_kept: null, note: null, paid_on: ago(245), record_id: null },
];
let listings: Listing[] = [
  { id: 'ls_1', title: 'Toyota Corolla 2017 LE', year: 2017, km: 112000, price: 14500, currency: 'USD', url: 'https://example.com/corolla-2017', place: 'North side', status: 'watching', note: null, day: ago(9) },
  { id: 'ls_2', title: 'Honda Civic 2018 EX', year: 2018, km: 98000, price: 17800, currency: 'USD', url: 'https://example.com/civic-2018', place: 'Downtown', status: 'contacted', note: null, day: ago(5) },
  { id: 'ls_3', title: 'Toyota Corolla 2019 SE', year: 2019, km: 74000, price: 19000, currency: 'USD', url: null, place: 'East side', status: 'watching', note: null, day: ago(2) },
  { id: 'ls_4', title: 'Honda Civic 2015 repainted', year: 2015, km: 160000, price: 9800, currency: 'USD', url: null, place: 'Suburbs', status: 'rejected', note: null, day: ago(20) },
];
const fund: CarFund = {
  id: 'g_car', name: 'Car fund', current: 4200, target: 15000, unit: 'USD', progress: 0.28,
  pace_line: 'Needs about $1,550 a month to land on time.', target_date: addDays(today(), 210),
};

const main = () => cars.find((c) => c.is_default) ?? cars[0] ?? null;
const live = <T extends { car_id: string }>(rows: T[], car: Car) => rows.filter((r) => r.car_id === car.id);
function currentKm(car: Car): number | null {
  const all = [car.start_km, ...live(kmRows, car).map((r) => r.km), ...live(fills, car).map((r) => r.km), ...live(jobs, car).map((r) => r.km)]
    .filter((n): n is number => typeof n === 'number');
  return all.length ? Math.max(...all) : null;
}

function withEconomy(car: Car): Fill[] {
  const asc = live(fills, car).slice().sort((a, b) => a.day.localeCompare(b.day));
  let prevFull: Fill | null = null;
  let litresSince = 0;
  const out = asc.map((f) => {
    let l100: number | null = null;
    if (prevFull) litresSince += f.litres ?? 0;
    if (f.full && prevFull && f.km != null && prevFull.km != null && f.km > prevFull.km) l100 = round((litresSince / (f.km - prevFull.km)) * 100, 1);
    if (f.full) {
      prevFull = f;
      litresSince = 0;
    }
    const ppl = f.litres && f.amount ? round(f.amount / f.litres, 1) : null;
    return { ...f, l_per_100: l100, price_per_l: ppl };
  });
  return out.reverse();
}

function due(car: Car, day: string): DueItem[] {
  const k = currentKm(car);
  const items: DueItem[] = [];
  const latest = new Map<string, ServiceJob>();
  for (const j of live(jobs, car).sort((a, b) => a.day.localeCompare(b.day))) latest.set(j.kind, j);
  for (const j of latest.values()) {
    if (j.next_km == null && !j.next_day) continue;
    const kmLeft = j.next_km != null && k != null ? j.next_km - k : null;
    const daysLeft = j.next_day ? daysBetween(day, j.next_day) : null;
    const state = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0) ? 'due' : (kmLeft != null && kmLeft <= 1000) || (daysLeft != null && daysLeft <= 30) ? 'soon' : 'later';
    const parts: string[] = [];
    if (kmLeft != null) parts.push(kmLeft <= 0 ? `${Math.abs(kmLeft).toLocaleString('en-US')} km past` : `in ${kmLeft.toLocaleString('en-US')} km`);
    if (daysLeft != null) parts.push(daysLeft <= 0 ? 'past date' : `in ${daysLeft} days`);
    items.push({ source: 'service', id: j.id, car_id: car.id, kind: j.kind, title: j.title, next_km: j.next_km, next_day: j.next_day, km_left: kmLeft, days_left: daysLeft, state, line: parts.join(' or ') });
  }
  for (const p of live(papers, car).filter((x) => !x.replaced && x.expires_on)) {
    const dl = daysBetween(day, p.expires_on!);
    const state = dl <= 0 ? 'due' : dl <= 30 ? 'soon' : 'later';
    items.push({ source: 'paper', id: p.id, car_id: car.id, kind: p.kind, title: p.name, next_km: null, next_day: p.expires_on, km_left: null, days_left: dl, state, line: dl <= 0 ? 'past date' : `ends in ${dl} days` });
  }
  const rank = { due: 0, soon: 1, later: 2 } as const;
  return items.sort((a, b) => rank[a.state] - rank[b.state] || (a.days_left ?? 9999) - (b.days_left ?? 9999));
}

function spend(car: Car, from: string, to: string): Spend {
  const inR = (d: string | null) => !!d && d >= from && d <= to;
  const fuel = live(fills, car).filter((r) => inR(r.day)).reduce((s, r) => s + (r.amount ?? 0), 0);
  const service = live(jobs, car).filter((r) => inR(r.day)).reduce((s, r) => s + (r.amount ?? 0), 0);
  const pp = live(papers, car).filter((r) => inR(r.paid_on)).reduce((s, r) => s + (r.amount ?? 0), 0);
  return { fuel, service, papers: pp, total: fuel + service + pp, currency: car.currency, skipped: 0 };
}

function buying() {
  const open = listings.filter((l) => l.status !== 'rejected' && l.status !== 'bought');
  const prices = open.map((l) => l.price).filter((n): n is number => n != null).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
  const cheapest = prices[0] ?? null;
  // Same as the API: the fund (USD) over the cheapest open listing.
  const have = fund.current ?? 0;
  const pct = cheapest ? Math.round((have / cheapest) * 100) : null;
  const fund_covers = pct === null ? null : { pct, fund_usd: round(have, 0), line: `Fund covers ${pct}% of the cheapest listing` };
  return { fund, open: open.length, fund_covers, cheapest, median, currency: 'USD', listings: open };
}

function overview(day: string): CarOverview {
  const car = main();
  const base = { cars, due: [] as DueItem[], buying: buying(), intervals: INTERVALS, paper_labels: PAPER_LABELS };
  if (!car) return { ...base, car: null };
  const k = currentKm(car);
  const econ = withEconomy(car);
  const vals = econ.map((f) => f.l_per_100).filter((n): n is number => n != null);
  const month = day.slice(0, 7);
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${month}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    const ym = d.toISOString().slice(0, 7);
    const s = spend(car, `${ym}-01`, `${ym}-31`);
    return { month: ym, fuel: s.fuel, service: s.service, papers: s.papers };
  });
  const l90 = spend(car, addDays(day, -90), day);
  const lastFill = econ[0] ?? null;
  const lastJob = live(jobs, car).sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  return {
    ...base,
    car: { ...car, km: k },
    km_per_month: 1250,
    economy: { last: vals[0] ?? null, avg: vals.length ? round(vals.reduce((s, n) => s + n, 0) / vals.length, 1) : null },
    this_month: spend(car, `${month}-01`, day),
    last_90: l90,
    cost_per_km: round(l90.total / 3600, 2),
    monthly,
    last_fill: lastFill ? { ...lastFill, days_ago: daysBetween(lastFill.day, day) } : null,
    last_service: lastJob ? { ...lastJob, days_ago: daysBetween(lastJob.day, day) } : null,
    due: due(car, day),
    papers: live(papers, car).filter((p) => !p.replaced),
  };
}

export function carGlance(): CarGlance | null {
  const car = main();
  const b = buying();
  if (!car) return b.open || fund ? { car: null, km: null, due: 0, soon: 0, next: null, month_spend: null, fund, listings: b.open } : null;
  const ds = due(car, today());
  const first = ds.find((x) => x.state !== 'later') ?? ds[0];
  return {
    car: car.name, km: currentKm(car), due: ds.filter((x) => x.state === 'due').length, soon: ds.filter((x) => x.state === 'soon').length,
    next: first ? `${first.title} ${first.line}` : null, month_spend: spend(car, `${today().slice(0, 7)}-01`, today()).total,
    currency: car.currency, fund, listings: b.open,
  };
}

const gone = (id: string) => ok({ id, deleted: true });

export function handleCar(c: Ctx): Res | null {
  const { route, b, qp } = c;
  if (!route.includes(' /car')) return null;
  let m: string[] | null;
  const car = main();
  const day = str(b.day) || today();

  if (route === 'GET /car') return ok(overview(qp.get('day') ?? today()));
  if (route === 'GET /car/due') return ok(car ? due(car, today()) : []);
  if (route === 'GET /car/cars') return ok(cars);
  if (route === 'POST /car/cars') {
    const make = str(b.make).trim() || null;
    const model = str(b.model).trim() || null;
    const name = str(b.name).trim() || [make, model].filter(Boolean).join(' ');
    if (!name) return bad('Give the car a name, or a make and model.');
    const row: Car = {
      id: idOf(b, 'car'), name, make, model, year: optNum(b.year), plate: str(b.plate) || null, fuel: str(b.fuel, 'petrol'), tank_l: optNum(b.tank_l),
      status: 'owned', bought_on: null, bought_price: null, currency: 'USD', start_km: optNum(b.start_km), note: null, is_default: cars.length === 0,
    };
    cars.push(row);
    return created(row);
  }
  if ((m = match(route, /^PATCH \/car\/cars\/([^/]+)$/))) {
    const row = cars.find((x) => x.id === m![0]);
    if (!row) return notFound('Car');
    Object.assign(row, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
    if (!str(b.name) && (b.make || b.model)) row.name = [row.make, row.model].filter(Boolean).join(' ');
    return ok(row);
  }
  if ((m = match(route, /^DELETE \/car\/cars\/([^/]+)$/))) {
    cars = cars.filter((x) => x.id !== m![0]);
    if (cars[0] && !cars.some((x) => x.is_default)) cars[0].is_default = true;
    return gone(m[0]);
  }
  if (!car && /^(POST) \/car\/(km|fuel|service|papers)/.test(route)) return bad('Save a car first.');

  if (route === 'GET /car/km') return ok(car ? live(kmRows, car).slice().reverse() : []);
  if (route === 'POST /car/km') {
    const km = optNum(b.km);
    if (km == null) return bad('km is required.');
    const cur = currentKm(car!);
    if (cur != null && km < cur) return bad(`That is below the last reading (${cur.toLocaleString('en-US')} km).`);
    const row: KmReading = { id: idOf(b, 'km'), car_id: car!.id, day, km, note: null };
    kmRows.push(row);
    return created(row);
  }
  if ((m = match(route, /^DELETE \/car\/km\/([^/]+)$/))) {
    kmRows = kmRows.filter((x) => x.id !== m![0]);
    return gone(m[0]);
  }

  if (route === 'GET /car/fuel') return ok(car ? withEconomy(car) : []);
  if (route === 'POST /car/fuel') {
    let litres = optNum(b.litres);
    let amount = optNum(b.amount);
    const ppl = optNum(b.price_per_l);
    if (litres == null && amount != null && ppl) litres = round(amount / ppl, 2);
    if (amount == null && litres != null && ppl) amount = round(litres * ppl, 0);
    if (litres == null && amount == null) return bad('Give the litres or the amount.');
    const row: Fill = {
      id: idOf(b, 'fl'), car_id: car!.id, day, km: optNum(b.km), litres, amount, currency: 'USD', full: b.full !== false,
      station: str(b.station) || null, note: null, record_id: amount != null ? idOf({}, 'rec') : null, money_note: null,
    };
    fills.push(row);
    return created(row);
  }
  if ((m = match(route, /^DELETE \/car\/fuel\/([^/]+)$/))) {
    fills = fills.filter((x) => x.id !== m![0]);
    return gone(m[0]);
  }

  if (route === 'GET /car/service') return ok(car ? live(jobs, car).slice().sort((a, b2) => b2.day.localeCompare(a.day)) : []);
  if (route === 'POST /car/service') {
    const kind = str(b.kind, 'other');
    const gap = INTERVALS[kind] ?? INTERVALS.other;
    const km = optNum(b.km);
    const amount = optNum(b.amount);
    const row: ServiceJob = {
      id: idOf(b, 'sv'), car_id: car!.id, day, km, kind, title: str(b.title).trim() || gap.label, amount, currency: 'USD', garage: str(b.garage) || null, note: null,
      next_km: gap.km && km != null ? km + gap.km : null, next_day: gap.months ? addMonths(day, gap.months) : null, record_id: amount != null ? idOf({}, 'rec') : null, money_note: null,
    };
    jobs.push(row);
    return created(row);
  }
  if ((m = match(route, /^PATCH \/car\/service\/([^/]+)$/))) {
    const row = jobs.find((x) => x.id === m![0]);
    if (!row) return notFound('Service');
    Object.assign(row, b);
    return ok(row);
  }
  if ((m = match(route, /^DELETE \/car\/service\/([^/]+)$/))) {
    jobs = jobs.filter((x) => x.id !== m![0]);
    return gone(m[0]);
  }

  if (route === 'GET /car/papers') return ok(car ? live(papers, car).filter((p) => qp.get('history') === '1' || !p.replaced) : []);
  if (route === 'POST /car/papers') {
    const kind = str(b.kind, 'other');
    if (!PAPER_LABELS[kind]) return bad('Unknown paper kind.');
    const amount = optNum(b.amount);
    const row: Paper = {
      id: idOf(b, 'pp'), car_id: car!.id, kind, name: str(b.name).trim() || PAPER_LABELS[kind], expires_on: str(b.expires_on) || null, amount, currency: 'USD',
      where_kept: str(b.where_kept) || null, note: null, paid_on: str(b.paid_on) || null, record_id: amount != null ? idOf({}, 'rec') : null, money_note: null,
    };
    papers.push(row);
    return created(row);
  }
  if ((m = match(route, /^POST \/car\/papers\/([^/]+)\/renew$/))) {
    const old = papers.find((x) => x.id === m![0]);
    if (!old) return notFound('Paper');
    old.replaced = true;
    const row = { ...old, id: idOf({}, 'pp'), expires_on: str(b.expires_on), amount: optNum(b.amount), paid_on: today(), replaced: false };
    papers.push(row);
    return created(row);
  }
  if ((m = match(route, /^DELETE \/car\/papers\/([^/]+)$/))) {
    papers = papers.filter((x) => x.id !== m![0]);
    return gone(m[0]);
  }

  if (route === 'GET /car/listings') {
    const s = qp.get('status');
    return ok(listings.filter((l) => !s || (s === 'open' ? l.status !== 'rejected' && l.status !== 'bought' : l.status === s)).slice().sort((a, b2) => b2.day.localeCompare(a.day)));
  }
  if (route === 'POST /car/listings') {
    const title = str(b.title).trim();
    if (!title) return bad('A title is required.');
    const url = str(b.url).trim() || null;
    if (url && !/^https?:\/\//i.test(url)) return bad('The link must start with http:// or https://.');
    const dup = url ? listings.find((l) => l.url === url) : undefined;
    if (dup) return ok({ ...dup, existing: true });
    const row: Listing = {
      id: idOf(b, 'ls'), title, year: optNum(b.year), km: optNum(b.km), price: optNum(b.price), currency: 'USD', url, place: str(b.place) || null,
      status: 'watching', note: null, day: today(),
    };
    listings.push(row);
    return created(row);
  }
  if ((m = match(route, /^PATCH \/car\/listings\/([^/]+)$/))) {
    const row = listings.find((x) => x.id === m![0]);
    if (!row) return notFound('Listing');
    Object.assign(row, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
    return ok(row);
  }
  if ((m = match(route, /^DELETE \/car\/listings\/([^/]+)$/))) {
    listings = listings.filter((x) => x.id !== m![0]);
    return gone(m[0]);
  }
  return null;
}
