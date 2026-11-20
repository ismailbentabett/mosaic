// Car: the car itself, km, fuel, service, papers and the next-car search.
// Amounts are optional. When given (and log_money is not false) the same spend is saved once in money,
// under Transport/Fuel, Transport/Car maintenance or Transport/Car papers, and deleting the car entry removes it there too.
// Copy rules: no streaks, no scores, no guilt words. Dates that passed are "past date", never anything louder.
import { AppError } from '../../errors.ts';
import { addDays, daysBetween, isDate, lifeToday } from '../../time.ts';
import { all, idOr, insert, need, one, patch, round, run, softDelete } from '../util.ts';
import type { Row } from '../util.ts';
import { addRecord, deleteRecord, getAccount, getRecord, rateFor } from '../money/store.ts';
import { goalView } from '../grades/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const NUMBERY = /\d[\d\s-]{11,}\d/;
const clean = (s: unknown, max: number, what: string, required = true): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) bad(`${what} is required`);
  if (t.length > max) bad(`${what} max ${max} characters`);
  return t;
};
/** Free text that must never hold a card or account number. */
const safe = (s: unknown, max: number, what: string, required = false): string | null => {
  const t = clean(s, max, what, required);
  if (NUMBERY.test(t)) bad('That looks like an account or card number. Do not store it here: see password manager.');
  return t || null;
};
const optNum = (v: unknown, what: string, min = 0, max = 1e10): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`${what} must be a number from ${min} to ${max}`);
  return n;
};
const optInt = (v: unknown, what: string, min = 0, max = 5_000_000) => { const n = optNum(v, what, min, max); return n === null ? null : Math.round(n); };
const optDay = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) bad(`${what} must be YYYY-MM-DD`);
  return v as string;
};
const dayOr = (v: unknown) => optDay(v, 'day') ?? lifeToday();
const CUR_RE = /^[A-Z]{3}$/;
const cur = (v: unknown, fallback: string) => {
  const c = String(v ?? fallback).toUpperCase();
  if (!CUR_RE.test(c)) bad('currency must be a 3-letter code');
  return c;
};
const pick = <T extends string>(v: unknown, list: readonly T[], what: string, fallback: T): T => {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).toLowerCase().replace(/[\s-]+/g, '_') as T;
  if (!list.includes(s)) bad(`${what} must be one of ${list.join(', ')}`);
  return s;
};
const fmtKm = (n: number) => `${Math.round(n).toLocaleString('en-US')} km`;
const fmtAmt = (n: number, c: string) => `${Math.round(n).toLocaleString('en-US')} ${c}`;

export const FUELS = ['petrol', 'diesel', 'gpl', 'hybrid', 'electric'] as const;
export const CAR_STATUS = ['owned', 'wanted', 'sold'] as const;
export const SERVICE_KINDS = ['oil', 'filters', 'tyres', 'brakes', 'battery', 'timing_belt', 'inspection', 'wash', 'repair', 'other'] as const;
export const PAPER_KINDS = ['insurance', 'registration', 'technical', 'vignette', 'licence', 'other'] as const;
export const LISTING_STATUS = ['watching', 'contacted', 'seen', 'rejected', 'bought'] as const;
type ServiceKind = (typeof SERVICE_KINDS)[number];
type PaperKind = (typeof PAPER_KINDS)[number];

/** Usual gaps used to fill "next due" when a service is logged without one. A starting point, not a rule: edit per car. */
export const SERVICE_INTERVALS: Record<ServiceKind, { km?: number; months?: number; label: string }> = {
  oil: { km: 10000, months: 12, label: 'Oil change' },
  filters: { km: 15000, months: 12, label: 'Filters' },
  tyres: { km: 40000, months: 48, label: 'Tyres' },
  brakes: { km: 30000, months: 24, label: 'Brakes' },
  battery: { months: 48, label: 'Battery' },
  timing_belt: { km: 90000, months: 60, label: 'Timing belt' },
  inspection: { months: 12, label: 'Inspection' },
  wash: { label: 'Wash' },
  repair: { label: 'Repair' },
  other: { label: 'Service' },
};
export const PAPER_LABEL: Record<PaperKind, string> = {
  insurance: 'Insurance', registration: 'Registration (carte grise)', technical: 'Technical check (contrôle technique)',
  vignette: 'Vignette', licence: 'Driving licence', other: 'Paper',
};
const SOON_DAYS = 30;
const SOON_KM = 1000;

// =====================================================================================================
// Cars
// =====================================================================================================
const carRow = (r: Row) => ({ ...r, is_default: !!r.is_default });
export const listCars = (includeSold = true) => all<Row>(
  `SELECT * FROM cars WHERE deleted_at IS NULL ${includeSold ? '' : `AND status != 'sold'`} ORDER BY is_default DESC, status = 'sold', created_at`).map(carRow);
export const findCar = (ref: string) => one<Row>(`SELECT * FROM cars WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))`, ref, ref);
/** The car to use when none is named: the default one, else the first owned one, else the first. */
export const defaultCar = () => one<Row>(
  `SELECT * FROM cars WHERE deleted_at IS NULL ORDER BY is_default DESC, status = 'owned' DESC, status = 'sold', created_at LIMIT 1`);
const carOf = (ref?: string | null): Row => {
  if (ref) return need(findCar(ref), `car ${ref}`);
  const c = defaultCar();
  if (!c) bad('Add your car first (car_add).');
  return c as Row;
};

export type CarInput = {
  id?: string; name?: string; make?: string; model?: string; year?: number; plate?: string; fuel?: string; tank_l?: number;
  status?: string; bought_on?: string; bought_price?: number; currency?: string; start_km?: number; note?: string; is_default?: boolean;
};
const carFields = (c: CarInput, partial: boolean): Row => {
  const f: Row = {};
  if (!partial || c.name !== undefined) {
    const auto = [c.make, c.model].filter(Boolean).join(' ');
    f.name = clean(c.name ?? (auto || undefined), 60, 'name');
  }
  if (c.make !== undefined) f.make = clean(c.make, 40, 'make', false) || null;
  if (c.model !== undefined) f.model = clean(c.model, 40, 'model', false) || null;
  if (c.year !== undefined) f.year = optInt(c.year, 'year', 1950, 2100);
  if (c.plate !== undefined) f.plate = clean(c.plate, 20, 'plate', false) || null;
  if (c.fuel !== undefined || !partial) f.fuel = pick(c.fuel, FUELS, 'fuel', 'petrol');
  if (c.tank_l !== undefined) f.tank_l = optNum(c.tank_l, 'tank_l', 1, 200);
  if (c.status !== undefined || !partial) f.status = pick(c.status, CAR_STATUS, 'status', 'owned');
  if (c.bought_on !== undefined) f.bought_on = optDay(c.bought_on, 'bought_on');
  if (c.bought_price !== undefined) f.bought_price = optNum(c.bought_price, 'bought_price');
  if (c.currency !== undefined || !partial) f.currency = cur(c.currency, 'USD');
  if (c.start_km !== undefined) f.start_km = optInt(c.start_km, 'start_km');
  if (c.note !== undefined) f.note = safe(c.note, 1000, 'note');
  return f;
};
const setDefault = (id: string) => { run(`UPDATE cars SET is_default = 0 WHERE is_default = 1 AND id != ?`, id); run(`UPDATE cars SET is_default = 1 WHERE id = ?`, id); };

export const addCar = (c: CarInput) => {
  const id = idOr(c.id);
  const existing = one<Row>(`SELECT * FROM cars WHERE id = ?`, id);
  if (existing) return carRow(existing);
  const f = carFields(c, false);
  if (findCar(f.name)) bad(`a car named "${f.name}" exists`);
  const first = !defaultCar();
  insert('cars', { id, ...f, is_default: 0 });
  if (first || c.is_default) setDefault(id);
  return carRow(need(findCar(id), 'car'));
};
export const updateCar = (ref: string, c: CarInput) => {
  const car = need(findCar(ref), `car ${ref}`);
  const f = carFields(c, true);
  if (f.name && f.name.toLowerCase() !== String(car.name).toLowerCase() && findCar(f.name)) bad(`a car named "${f.name}" exists`);
  patch('cars', car.id, f);
  if (c.is_default) setDefault(car.id);
  return carRow(need(findCar(car.id), 'car'));
};
export const deleteCar = (ref: string) => {
  const car = need(findCar(ref), `car ${ref}`);
  softDelete('cars', car.id);
  if (car.is_default) { const next = defaultCar(); if (next) setDefault(next.id); }
  return { id: car.id, deleted: true };
};

// =====================================================================================================
// Km
// =====================================================================================================
type Reading = { day: string; km: number };
const readings = (carId: string): Reading[] => all<Reading>(
  `SELECT day, km FROM car_odometer WHERE car_id = ? AND deleted_at IS NULL
   UNION ALL SELECT day, km FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL AND km IS NOT NULL
   UNION ALL SELECT day, km FROM car_service WHERE car_id = ? AND deleted_at IS NULL AND km IS NOT NULL
   ORDER BY day, km`, carId, carId, carId).map((r) => ({ day: String(r.day), km: Number(r.km) }));
/** Highest km seen in any log (or the start km). */
export const currentKm = (car: Row): number | null => {
  const r = one<{ km: number | null }>(
    `SELECT MAX(km) AS km FROM (SELECT km FROM car_odometer WHERE car_id = ? AND deleted_at IS NULL
      UNION ALL SELECT km FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL
      UNION ALL SELECT km FROM car_service WHERE car_id = ? AND deleted_at IS NULL)`, car.id, car.id, car.id);
  const vals = [r?.km, car.start_km].filter((v): v is number => v !== null && v !== undefined).map(Number);
  return vals.length ? Math.max(...vals) : null;
};
/** Km a month from readings in the last 180 days (needs 2 readings at least 7 days apart). */
const kmPerMonth = (carId: string, today: string): number | null => {
  const rs = readings(carId).filter((r) => r.day >= addDays(today, -180) && r.day <= today);
  if (rs.length < 2) return null;
  const a = rs[0], b = rs.reduce((m, r) => (r.km >= m.km ? r : m), rs[0]);
  const days = daysBetween(a.day, b.day);
  if (days < 7 || b.km <= a.km) return null;
  return Math.round(((b.km - a.km) / days) * 30);
};
const kmCheck = (car: Row, km: number | null, day: string) => {
  if (km === null) return;
  const later = one<{ km: number }>(
    `SELECT MIN(km) AS km FROM (SELECT km FROM car_odometer WHERE car_id = ? AND deleted_at IS NULL AND day > ?
      UNION ALL SELECT km FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL AND km IS NOT NULL AND day > ?)`, car.id, day, car.id, day);
  if (later?.km !== null && later?.km !== undefined && km > Number(later.km) + 5) bad(`${fmtKm(km)} is more than a later reading (${fmtKm(Number(later.km))}). Check the number or the day.`);
  const earlier = one<{ km: number }>(
    `SELECT MAX(km) AS km FROM (SELECT km FROM car_odometer WHERE car_id = ? AND deleted_at IS NULL AND day < ?
      UNION ALL SELECT km FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL AND km IS NOT NULL AND day < ?)`, car.id, day, car.id, day);
  if (earlier?.km !== null && earlier?.km !== undefined && km < Number(earlier.km) - 5) bad(`${fmtKm(km)} is less than an earlier reading (${fmtKm(Number(earlier.km))}). Check the number or the day.`);
};

export const logKm = (k: { id?: string; car?: string; day?: string; km: number; note?: string }) => {
  const car = carOf(k.car);
  const id = idOr(k.id);
  const hit = one<Row>(`SELECT * FROM car_odometer WHERE id = ?`, id);
  if (hit) return hit;
  const km = optInt(k.km, 'km');
  if (km === null) bad('km is required');
  const day = dayOr(k.day);
  kmCheck(car, km, day);
  insert('car_odometer', { id, car_id: car.id, day, km, note: safe(k.note, 300, 'note') });
  return need(one<Row>(`SELECT * FROM car_odometer WHERE id = ?`, id), 'reading');
};
export const listKm = (ref?: string, limit = 50) => {
  const car = carOf(ref);
  return all<Row>(`SELECT * FROM car_odometer WHERE car_id = ? AND deleted_at IS NULL ORDER BY day DESC, km DESC LIMIT ?`, car.id, Math.min(Math.max(limit, 1), 500));
};
export const deleteKm = (id: string) => { need(one(`SELECT id FROM car_odometer WHERE id = ? AND deleted_at IS NULL`, id), 'reading'); softDelete('car_odometer', id); return { id, deleted: true }; };

// =====================================================================================================
// Money link
// =====================================================================================================
type MoneyOpts = { account?: string; log_money?: boolean };
/** Save the spend in money. Returns the record id, or a note saying why it was not saved. */
const toMoney = (o: MoneyOpts, amount: number | null, currency: string, category: string, day: string, note: string, payee: string | null)
  : { record_id: string | null; money_note: string | null } => {
  if (amount === null || amount <= 0 || o.log_money === false) return { record_id: null, money_note: null };
  let account: string | undefined;
  if (o.account) {
    const a = need(getAccount(o.account), `account ${o.account}`);
    if (a.currency !== currency) bad(`account ${a.name} is in ${a.currency}; this entry is in ${currency}`);
    account = a.id;
  } else {
    const a = one<{ id: string }>(`SELECT id FROM accounts WHERE deleted_at IS NULL AND archived = 0 AND track = 'personal' AND currency = ? ORDER BY sort, created_at LIMIT 1`, currency);
    const anyPersonal = one(`SELECT id FROM accounts WHERE deleted_at IS NULL AND archived = 0 AND track = 'personal' LIMIT 1`);
    if (a) account = a.id;
    else if (anyPersonal || currency !== 'USD') return { record_id: null, money_note: `No personal account in ${currency}, so this was not added to money.` };
  }
  const rec = addRecord({ account, kind: 'expense', amount, currency, category, day, note, payee: payee ?? undefined, labels: ['car'] });
  return { record_id: String(rec.id), money_note: null };
};
const dropRecord = (recordId: unknown) => {
  if (!recordId) return;
  try { if (getRecord(String(recordId))) deleteRecord(String(recordId)); } catch { /* already gone */ }
};

// =====================================================================================================
// Fuel
// =====================================================================================================
export type FuelInput = MoneyOpts & {
  id?: string; car?: string; day?: string; km?: number; litres?: number; amount?: number; price_per_l?: number; currency?: string;
  full?: boolean; station?: string; note?: string;
};
export const addFuel = (f: FuelInput) => {
  const car = carOf(f.car);
  const id = idOr(f.id);
  const hit = one<Row>(`SELECT * FROM car_fuel WHERE id = ?`, id);
  if (hit) return fuelRow(hit);
  const day = dayOr(f.day);
  const km = optInt(f.km, 'km');
  let litres = optNum(f.litres, 'litres', 0.1, 500);
  let amount = optNum(f.amount, 'amount');
  const ppl = optNum(f.price_per_l, 'price_per_l', 0.01, 100000);
  if (litres === null && amount !== null && ppl) litres = round(amount / ppl, 2);
  if (amount === null && litres !== null && ppl) amount = round(litres * ppl, 2);
  if (litres === null && amount === null) bad('give litres or an amount');
  kmCheck(car, km, day);
  const currency = cur(f.currency, car.currency);
  const station = safe(f.station, 80, 'station');
  const note = safe(f.note, 300, 'note');
  const m = toMoney(f, amount, currency, 'Transport/Fuel', day, [`Fuel${litres ? ` ${litres} L` : ''}`, String(car.name)].join(' · '), station);
  insert('car_fuel', { id, car_id: car.id, day, km, litres, amount, currency, full: f.full === false ? 0 : 1, station, note, record_id: m.record_id });
  return { ...fuelRow(need(one<Row>(`SELECT * FROM car_fuel WHERE id = ?`, id), 'fill')), money_note: m.money_note };
};
const fuelRow = (r: Row) => ({ ...r, full: !!r.full });
/** Fills newest first, each with L/100 km when it closes a full-to-full span. */
export const listFuel = (ref?: string, limit = 100) => {
  const car = carOf(ref);
  const rows = all<Row>(`SELECT * FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL ORDER BY day, COALESCE(km, 0), created_at`, car.id).map(fuelRow);
  const eco = economy(rows);
  return rows.map((r) => ({ ...r, l_per_100: eco.per.get(r.id) ?? null, price_per_l: r.amount && r.litres ? round(r.amount / r.litres, 2) : null }))
    .reverse().slice(0, Math.min(Math.max(limit, 1), 1000));
};
/** L/100 km between full fills: litres put in after the previous full fill (this one included) over the km driven. */
const economy = (rows: Row[]) => {
  const per = new Map<string, number>();
  let lastFull: Row | null = null, litres = 0, totL = 0, totKm = 0;
  for (const r of rows) {
    if (r.km === null || r.km === undefined) { if (lastFull) litres += Number(r.litres ?? 0); continue; }
    if (lastFull) litres += Number(r.litres ?? 0);
    if (r.full) {
      if (lastFull && r.km > lastFull.km && litres > 0) {
        const d = Number(r.km) - Number(lastFull.km);
        per.set(r.id, round((litres / d) * 100, 1));
        totL += litres; totKm += d;
      }
      lastFull = r; litres = 0;
    }
  }
  const last = [...per.values()].at(-1) ?? null;
  return { per, last, avg: totKm > 0 ? round((totL / totKm) * 100, 1) : null };
};
export const deleteFuel = (id: string) => {
  const r = need(one<Row>(`SELECT * FROM car_fuel WHERE id = ? AND deleted_at IS NULL`, id), 'fill');
  softDelete('car_fuel', id); dropRecord(r.record_id);
  return { id, deleted: true };
};

// =====================================================================================================
// Service
// =====================================================================================================
export type ServiceInput = MoneyOpts & {
  id?: string; car?: string; day?: string; km?: number; kind?: string; title?: string; amount?: number; currency?: string;
  garage?: string; note?: string; next_km?: number | null; next_day?: string | null; auto_next?: boolean;
};
const addMonths = (day: string, m: number) => {
  const [y, mo, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
export const addService = (s: ServiceInput) => {
  const car = carOf(s.car);
  const id = idOr(s.id);
  const hit = one<Row>(`SELECT * FROM car_service WHERE id = ?`, id);
  if (hit) return hit;
  const day = dayOr(s.day);
  const kind = pick(s.kind, SERVICE_KINDS, 'kind', 'other');
  const km = optInt(s.km, 'km') ?? (day === lifeToday() ? currentKm(car) : null);
  kmCheck(car, km, day);
  const iv = SERVICE_INTERVALS[kind];
  const title = clean(s.title ?? iv.label, 80, 'title');
  let nextKm = s.next_km === null ? null : optInt(s.next_km, 'next_km');
  let nextDay = s.next_day === null ? null : optDay(s.next_day, 'next_day');
  if (s.auto_next !== false && s.next_km === undefined && s.next_day === undefined) {
    if (iv.km && km !== null) nextKm = km + iv.km;
    if (iv.months) nextDay = addMonths(day, iv.months);
  }
  if (nextKm !== null && km !== null && nextKm <= km) bad('next_km must be above the km of this service');
  const amount = optNum(s.amount, 'amount');
  const currency = cur(s.currency, car.currency);
  const garage = safe(s.garage, 80, 'garage');
  const m = toMoney(s, amount, currency, 'Transport/Car maintenance', day, `${title} · ${car.name}`, garage);
  insert('car_service', { id, car_id: car.id, day, km, kind, title, amount, currency, garage, note: safe(s.note, 1000, 'note'),
    next_km: nextKm, next_day: nextDay, record_id: m.record_id });
  return { ...need(one<Row>(`SELECT * FROM car_service WHERE id = ?`, id), 'service'), money_note: m.money_note };
};
export const updateService = (id: string, s: Partial<ServiceInput>) => {
  const r = need(one<Row>(`SELECT * FROM car_service WHERE id = ? AND deleted_at IS NULL`, id), 'service');
  const f: Row = {};
  if (s.title !== undefined) f.title = clean(s.title, 80, 'title');
  if (s.kind !== undefined) f.kind = pick(s.kind, SERVICE_KINDS, 'kind', 'other');
  if (s.day !== undefined) f.day = dayOr(s.day);
  if (s.km !== undefined) f.km = optInt(s.km, 'km');
  if (s.garage !== undefined) f.garage = safe(s.garage, 80, 'garage');
  if (s.note !== undefined) f.note = safe(s.note, 1000, 'note');
  if (s.next_km !== undefined) f.next_km = s.next_km === null ? null : optInt(s.next_km, 'next_km');
  if (s.next_day !== undefined) f.next_day = s.next_day === null ? null : optDay(s.next_day, 'next_day');
  patch('car_service', r.id, f);
  return one<Row>(`SELECT * FROM car_service WHERE id = ?`, r.id);
};
export const listService = (ref?: string, limit = 100) => {
  const car = carOf(ref);
  return all<Row>(`SELECT * FROM car_service WHERE car_id = ? AND deleted_at IS NULL ORDER BY day DESC, COALESCE(km, 0) DESC LIMIT ?`, car.id, Math.min(Math.max(limit, 1), 1000));
};
export const deleteService = (id: string) => {
  const r = need(one<Row>(`SELECT * FROM car_service WHERE id = ? AND deleted_at IS NULL`, id), 'service');
  softDelete('car_service', id); dropRecord(r.record_id);
  return { id, deleted: true };
};

// =====================================================================================================
// Papers
// =====================================================================================================
export type PaperInput = MoneyOpts & {
  id?: string; car?: string; kind?: string; name?: string; expires_on?: string | null; amount?: number; currency?: string;
  where_kept?: string; note?: string; paid_on?: string;
};
export const addPaper = (p: PaperInput) => {
  const car = carOf(p.car);
  const id = idOr(p.id);
  const hit = one<Row>(`SELECT * FROM documents WHERE id = ?`, id);
  if (hit) return hit;
  const kind = pick(p.kind, PAPER_KINDS, 'kind', 'other');
  const name = clean(p.name ?? PAPER_LABEL[kind], 80, 'name');
  const expires = optDay(p.expires_on, 'expires_on');
  const paidOn = optDay(p.paid_on, 'paid_on') ?? lifeToday();
  const amount = optNum(p.amount, 'amount');
  const currency = cur(p.currency, car.currency);
  const m = toMoney(p, amount, currency, 'Transport/Car papers', paidOn, `${name} · ${car.name}`, null);
  insert('documents', { id, car_id: car.id, kind, name, tags: '["car"]', expires_on: expires, amount, currency, paid_on: amount ? paidOn : null,
    where_kept: safe(p.where_kept, 120, 'where_kept') ?? '', note: safe(p.note, 1000, 'note') ?? '', record_id: m.record_id });
  return { ...need(one<Row>(`SELECT * FROM documents WHERE id = ?`, id), 'paper'), money_note: m.money_note };
};
export const updatePaper = (id: string, p: Partial<PaperInput>) => {
  const r = need(one<Row>(`SELECT * FROM documents WHERE id = ? AND car_id IS NOT NULL AND deleted_at IS NULL`, id), 'paper');
  const f: Row = {};
  if (p.kind !== undefined) f.kind = pick(p.kind, PAPER_KINDS, 'kind', 'other');
  if (p.name !== undefined) f.name = clean(p.name, 80, 'name');
  if (p.expires_on !== undefined) f.expires_on = optDay(p.expires_on, 'expires_on');
  if (p.where_kept !== undefined) f.where_kept = safe(p.where_kept, 120, 'where_kept') ?? '';
  if (p.note !== undefined) f.note = safe(p.note, 1000, 'note') ?? '';
  patch('documents', r.id, f);
  return one<Row>(`SELECT * FROM documents WHERE id = ?`, r.id);
};
/** Renew: a new row for the new period (the old one stays as history). */
export const renewPaper = (id: string, p: { expires_on: string; amount?: number; currency?: string; paid_on?: string; account?: string; log_money?: boolean; new_id?: string }) => {
  const r = need(one<Row>(`SELECT * FROM documents WHERE id = ? AND car_id IS NOT NULL AND deleted_at IS NULL`, id), 'paper');
  if (!optDay(p.expires_on, 'expires_on')) bad('expires_on is required');
  const next = addPaper({ id: p.new_id, car: r.car_id, kind: r.kind, name: r.name, expires_on: p.expires_on, amount: p.amount,
    currency: p.currency ?? r.currency, where_kept: r.where_kept ?? undefined, paid_on: p.paid_on, account: p.account, log_money: p.log_money });
  run(`UPDATE documents SET note = CASE WHEN note = '' THEN 'Renewed' ELSE note || ' · Renewed' END, updated_at = ? WHERE id = ? AND note NOT LIKE '%Renewed'`, new Date().toISOString(), r.id);
  return next;
};
/** Current papers: the latest row per kind+name (renewed ones are history). */
export const listPapers = (ref?: string, history = false) => {
  const car = carOf(ref);
  const rows = all<Row>(`SELECT * FROM documents WHERE car_id = ? AND deleted_at IS NULL ORDER BY COALESCE(expires_on, '9999-12-31') DESC, created_at DESC`, car.id);
  if (history) return rows;
  const seen = new Set<string>();
  return rows.filter((r) => { const k = `${r.kind}|${String(r.name).toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(a.expires_on ?? '9999').localeCompare(String(b.expires_on ?? '9999')));
};
export const deletePaper = (id: string) => {
  const r = need(one<Row>(`SELECT * FROM documents WHERE id = ? AND car_id IS NOT NULL AND deleted_at IS NULL`, id), 'paper');
  softDelete('documents', id); dropRecord(r.record_id);
  return { id, deleted: true };
};

// =====================================================================================================
// Due list
// =====================================================================================================
export type DueItem = {
  source: 'service' | 'paper'; id: string; car_id: string; kind: string; title: string;
  next_km: number | null; next_day: string | null; km_left: number | null; days_left: number | null;
  state: 'due' | 'soon' | 'later'; line: string;
};
const stateOf = (kmLeft: number | null, daysLeft: number | null): DueItem['state'] =>
  (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0) ? 'due'
    : (kmLeft !== null && kmLeft <= SOON_KM) || (daysLeft !== null && daysLeft <= SOON_DAYS) ? 'soon' : 'later';
const daysText = (d: number) => (d < 0 ? 'past date' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
const kmText = (k: number) => (k <= 0 ? `${fmtKm(-k)} past` : `${fmtKm(k)} left`);

export const dueFor = (car: Row, today = lifeToday()): DueItem[] => {
  const km = currentKm(car);
  const out: DueItem[] = [];
  const latest = all<Row>(`SELECT s.* FROM car_service s WHERE s.car_id = ? AND s.deleted_at IS NULL AND s.id = (
      SELECT s2.id FROM car_service s2 WHERE s2.car_id = s.car_id AND s2.kind = s.kind AND s2.deleted_at IS NULL
      AND (s.kind NOT IN ('other', 'repair', 'wash') OR lower(s2.title) = lower(s.title))
      ORDER BY s2.day DESC, COALESCE(s2.km, 0) DESC, s2.created_at DESC LIMIT 1)`, car.id);
  for (const s of latest) {
    if (s.next_km === null && s.next_day === null) continue;
    const kmLeft = s.next_km !== null && km !== null ? Number(s.next_km) - km : null;
    const daysLeft = s.next_day ? daysBetween(today, String(s.next_day)) : null;
    const parts = [kmLeft !== null ? `at ${fmtKm(Number(s.next_km))} · ${kmText(kmLeft)}` : null, daysLeft !== null ? `${s.next_day} · ${daysText(daysLeft)}` : null].filter(Boolean);
    out.push({ source: 'service', id: s.id, car_id: car.id, kind: s.kind, title: SERVICE_INTERVALS[s.kind as ServiceKind]?.label === s.title ? s.title : String(s.title),
      next_km: s.next_km ?? null, next_day: s.next_day ?? null, km_left: kmLeft, days_left: daysLeft, state: stateOf(kmLeft, daysLeft), line: `${s.title} ${parts.join(' or ')}` });
  }
  for (const p of listPapers(car.id)) {
    if (!p.expires_on) continue;
    const d = daysBetween(today, String(p.expires_on));
    out.push({ source: 'paper', id: p.id, car_id: car.id, kind: p.kind, title: p.name, next_km: null, next_day: p.expires_on, km_left: null, days_left: d,
      state: stateOf(null, d), line: `${p.name} ends ${p.expires_on} · ${daysText(d)}` });
  }
  const rank = { due: 0, soon: 1, later: 2 };
  const urgency = (x: DueItem) => Math.min(x.days_left ?? 99999, x.km_left !== null ? x.km_left / 30 : 99999);
  return out.sort((a, b) => rank[a.state] - rank[b.state] || urgency(a) - urgency(b));
};
export const carDue = (ref?: string, today = lifeToday()) => {
  const cars = ref ? [carOf(ref)] : listCars(false);
  return cars.flatMap((c) => dueFor(c, today).map((d) => ({ ...d, car: c.name })));
};

// =====================================================================================================
// Spend + overview
// =====================================================================================================
const toCur = (amount: number, from: string, to: string, day: string): number | null => {
  if (from === to) return amount;
  try { return (amount * rateFor(from, day).rate) / rateFor(to, day).rate; } catch { return null; }
};
type SpendRow = { type: 'fuel' | 'service' | 'papers'; day: string; amount: number; currency: string };
const spendRows = (carId: string, from: string, to: string): SpendRow[] => all<SpendRow>(
  `SELECT 'fuel' AS type, day, amount, currency FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL AND amount > 0 AND day >= ? AND day <= ?
   UNION ALL SELECT 'service', day, amount, currency FROM car_service WHERE car_id = ? AND deleted_at IS NULL AND amount > 0 AND day >= ? AND day <= ?
   UNION ALL SELECT 'papers', COALESCE(paid_on, substr(created_at, 1, 10)), amount, COALESCE(currency, 'USD') FROM documents WHERE car_id = ? AND deleted_at IS NULL AND amount > 0
     AND COALESCE(paid_on, substr(created_at, 1, 10)) >= ? AND COALESCE(paid_on, substr(created_at, 1, 10)) <= ?`,
  carId, from, to, carId, from, to, carId, from, to);
const spend = (car: Row, from: string, to: string) => {
  const by = { fuel: 0, service: 0, papers: 0 };
  let skipped = 0;
  for (const r of spendRows(car.id, from, to)) {
    const v = toCur(Number(r.amount), String(r.currency), String(car.currency), r.day);
    if (v === null) { skipped++; continue; }
    by[r.type] += v;
  }
  return { fuel: round(by.fuel, 0), service: round(by.service, 0), papers: round(by.papers, 0), total: round(by.fuel + by.service + by.papers, 0), currency: car.currency, skipped };
};
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
/** Spend per month for the last n months (oldest first). */
const monthly = (car: Row, today: string, n = 6) => {
  const out: { month: string; fuel: number; service: number; papers: number }[] = [];
  let m = monthStart(today);
  const months: string[] = [];
  for (let i = 0; i < n; i++) { months.unshift(m); m = monthStart(addDays(m, -1)); }
  for (const s of months) {
    const e = addDays(monthStart(addDays(s, 32)), -1);
    const x = spend(car, s, e);
    out.push({ month: s.slice(0, 7), fuel: x.fuel, service: x.service, papers: x.papers });
  }
  return out;
};

const carFund = (today: string) => {
  try {
    const g = one<Row>(`SELECT * FROM goals WHERE deleted_at IS NULL AND status = 'active' AND (seed_key = 'car_fund' OR auto LIKE 'savings:car%') ORDER BY created_at LIMIT 1`);
    if (!g) return null;
    const v = goalView(g, today);
    return { id: v.id, name: v.name, current: v.current, target: (v as Row).target_value ?? null, unit: (v as Row).unit ?? null, progress: v.progress, pace_line: v.pace_line,
      per_week_needed: v.per_week_needed, weeks_left: v.weeks_left, target_date: (v as Row).target_date ?? null };
  } catch { return null; }
};
export const listListings = (status?: string) => {
  const s = status ? pick(status, [...LISTING_STATUS, 'open' as never], 'status', 'watching') : null;
  const where = !s ? '' : (s as string) === 'open' ? `AND status IN ('watching', 'contacted', 'seen')` : `AND status = '${s}'`;
  return all<Row>(`SELECT * FROM car_listings WHERE deleted_at IS NULL ${where}
    ORDER BY CASE status WHEN 'seen' THEN 0 WHEN 'contacted' THEN 1 WHEN 'watching' THEN 2 WHEN 'bought' THEN 3 ELSE 4 END, day DESC, created_at DESC`);
};
/** How much of the cheapest open listing the car fund covers today (fund in its unit, converted to USD). */
export const fundCovers = (fund: { current: unknown; unit?: unknown } | null, cheapestUsd: number | null, today: string) => {
  if (!fund || !cheapestUsd || fund.current === null || fund.current === undefined) return null;
  const raw = String(fund.unit ?? '').trim().toUpperCase();
  const unit = !raw || raw === '$' ? 'USD' : raw;
  const have = toCur(Number(fund.current), unit, 'USD', today);
  if (have === null) return null;
  const pct = Math.round((have / cheapestUsd) * 100);
  return { pct, fund_usd: round(have, 0), line: `Fund covers ${pct}% of the cheapest listing` };
};
const buying = (today: string) => {
  const open = listListings('open');
  const prices = open.filter((l) => l.price).map((l) => ({ price: Number(l.price), currency: String(l.currency) }));
  const usd = prices.map((p) => toCur(p.price, p.currency, 'USD', today)).filter((x): x is number => x !== null);
  const cheapest = usd.length ? round(Math.min(...usd), 0) : null;
  const fund = carFund(today);
  return {
    fund, open: open.length, fund_covers: fundCovers(fund, cheapest, today),
    cheapest, median: usd.length ? round([...usd].sort((a, b) => a - b)[Math.floor(usd.length / 2)], 0) : null,
    currency: 'USD', listings: open.slice(0, 5),
  };
};

export const carOverview = (ref?: string, today = lifeToday()) => {
  const cars = listCars(true);
  const car = ref ? carOf(ref) : defaultCar() ?? null;
  if (!car) return { car: null, cars, buying: buying(today), due: [], intervals: SERVICE_INTERVALS, paper_labels: PAPER_LABEL };
  const km = currentKm(car);
  const fills = all<Row>(`SELECT * FROM car_fuel WHERE car_id = ? AND deleted_at IS NULL ORDER BY day, COALESCE(km, 0), created_at`, car.id).map(fuelRow);
  const eco = economy(fills);
  const last90 = spend(car, addDays(today, -89), today);
  const kmIn90 = (() => {
    const rs = readings(car.id).filter((r) => r.day >= addDays(today, -89) && r.day <= today);
    if (rs.length < 2) return null;
    const d = Math.max(...rs.map((r) => r.km)) - Math.min(...rs.map((r) => r.km));
    return d > 0 ? d : null;
  })();
  const lastFill = fills.at(-1) ?? null;
  const lastService = one<Row>(`SELECT * FROM car_service WHERE car_id = ? AND deleted_at IS NULL ORDER BY day DESC, COALESCE(km, 0) DESC LIMIT 1`, car.id) ?? null;
  const due = dueFor(car, today);
  return {
    car: { ...carRow(car), km },
    cars,
    km_per_month: kmPerMonth(car.id, today),
    economy: { last: eco.last, avg: eco.avg },
    this_month: spend(car, monthStart(today), today),
    last_90: last90,
    cost_per_km: kmIn90 && last90.total > 0 ? round(last90.total / kmIn90, 1) : null,
    monthly: monthly(car, today),
    last_fill: lastFill ? { ...lastFill, days_ago: daysBetween(String(lastFill.day), today) } : null,
    last_service: lastService ? { ...lastService, days_ago: daysBetween(String(lastService.day), today) } : null,
    due,
    papers: listPapers(car.id),
    buying: buying(today),
    intervals: SERVICE_INTERVALS,
    paper_labels: PAPER_LABEL,
  };
};

/** One line for the life snapshot and the Life hub card. */
export const carGlance = (today = lifeToday()) => {
  const car = defaultCar();
  const fund = carFund(today);
  const openListings = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM car_listings WHERE deleted_at IS NULL AND status IN ('watching', 'contacted', 'seen')`)?.n ?? 0);
  if (!car) return fund || openListings ? { car: null, km: null, due: 0, soon: 0, next: null, month_spend: null, fund, listings: openListings } : null;
  const due = dueFor(car, today);
  return {
    car: car.name, km: currentKm(car),
    due: due.filter((d) => d.state === 'due').length, soon: due.filter((d) => d.state === 'soon').length,
    next: due.find((d) => d.state !== 'later')?.line ?? null,
    month_spend: spend(car, monthStart(today), today).total, currency: car.currency,
    fund, listings: openListings,
  };
};

// =====================================================================================================
// Listings (buying the next car)
// =====================================================================================================
export type ListingInput = { id?: string; title?: string; year?: number; km?: number; price?: number; currency?: string; url?: string; place?: string; status?: string; note?: string; day?: string };
const urlOk = (u: unknown) => {
  const s = clean(u, 500, 'url', false);
  if (!s) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(s)) bad('url must start with http:// or https://');
  return s;
};
export const addListing = (l: ListingInput) => {
  const id = idOr(l.id);
  const hit = one<Row>(`SELECT * FROM car_listings WHERE id = ?`, id);
  if (hit) return hit;
  const url = urlOk(l.url);
  if (url) { const dup = one<Row>(`SELECT * FROM car_listings WHERE deleted_at IS NULL AND url = ?`, url); if (dup) return { ...dup, existing: true }; }
  insert('car_listings', {
    id, title: clean(l.title, 120, 'title'), year: optInt(l.year, 'year', 1950, 2100), km: optInt(l.km, 'km'), price: optNum(l.price, 'price'),
    currency: cur(l.currency, 'USD'), url, place: clean(l.place, 80, 'place', false) || null, status: pick(l.status, LISTING_STATUS, 'status', 'watching'),
    note: safe(l.note, 1000, 'note'), day: dayOr(l.day),
  });
  return need(one<Row>(`SELECT * FROM car_listings WHERE id = ?`, id), 'listing');
};
export const updateListing = (id: string, l: ListingInput) => {
  const r = need(one<Row>(`SELECT * FROM car_listings WHERE id = ? AND deleted_at IS NULL`, id), 'listing');
  const f: Row = {};
  if (l.title !== undefined) f.title = clean(l.title, 120, 'title');
  if (l.year !== undefined) f.year = optInt(l.year, 'year', 1950, 2100);
  if (l.km !== undefined) f.km = optInt(l.km, 'km');
  if (l.price !== undefined) f.price = optNum(l.price, 'price');
  if (l.currency !== undefined) f.currency = cur(l.currency, 'USD');
  if (l.url !== undefined) f.url = urlOk(l.url);
  if (l.place !== undefined) f.place = clean(l.place, 80, 'place', false) || null;
  if (l.status !== undefined) f.status = pick(l.status, LISTING_STATUS, 'status', 'watching');
  if (l.note !== undefined) f.note = safe(l.note, 1000, 'note');
  patch('car_listings', r.id, f);
  return one<Row>(`SELECT * FROM car_listings WHERE id = ?`, r.id);
};
export const deleteListing = (id: string) => { need(one(`SELECT id FROM car_listings WHERE id = ? AND deleted_at IS NULL`, id), 'listing'); softDelete('car_listings', id); return { id, deleted: true }; };

/** Plain-text summary for MCP. */
export const overviewText = (ref?: string, today = lifeToday()) => {
  const o = carOverview(ref, today);
  const lines: string[] = [];
  if (!o.car) lines.push('No car saved yet.');
  else {
    const c = o.car as Row;
    lines.push(`${c.name}${c.km !== null ? ` · ${fmtKm(c.km)}` : ''}${o.km_per_month ? ` · about ${fmtKm(o.km_per_month)} a month` : ''}`);
    if (o.economy?.avg) lines.push(`Fuel: ${o.economy.last ?? o.economy.avg} L/100 km last, ${o.economy.avg} average`);
    if (o.this_month) lines.push(`This month: ${fmtAmt(o.this_month.total, o.this_month.currency)} (fuel ${fmtAmt(o.this_month.fuel, o.this_month.currency)}, service ${fmtAmt(o.this_month.service, o.this_month.currency)}, papers ${fmtAmt(o.this_month.papers, o.this_month.currency)})`);
    if (o.cost_per_km) lines.push(`Cost per km (90 days): ${o.cost_per_km} ${c.currency}`);
    const near = o.due.filter((d) => d.state !== 'later');
    lines.push(near.length ? `Coming up:\n${near.map((d) => `- ${d.line}`).join('\n')}` : 'Nothing due in the next 30 days or 1,000 km.');
  }
  const b = o.buying;
  if (b.fund) lines.push(`Car fund: ${b.fund.pace_line}`);
  if (b.fund_covers) lines.push(`${b.fund_covers.line}.`);
  if (b.open) lines.push(`Watching ${b.open} listing${b.open === 1 ? '' : 's'}${b.cheapest ? `, from ${fmtAmt(b.cheapest, 'USD')}` : ''}`);
  return lines.join('\n');
};
