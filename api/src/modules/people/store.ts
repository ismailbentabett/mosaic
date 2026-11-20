// People and promises: promises ledger, tiny habits, time capsules, people light, occasions,
// waiting check-on dates, week facts and the 14-day strip.
// Rules: no streaks, no guilt words, neutral phrasing. Saturday is quiet for nudges (occasions still show).
import { AppError } from '../../errors.ts';
import { isDate as isDateRaw, addDays, lifeDay, lifeToday, dowOf, weekStartOf, daysBetween } from '../../time.ts';
import { all, one, run, patch, need, now, idOr, insert, softDelete, round } from '../util.ts';
import type { Row } from '../util.ts';
import * as tasks from '../tasks/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
// time.isDate throws on impossible months (2026-13-01): wrap it so bad dates are a plain bad_request.
const isDate = (s: unknown): s is string => { try { return isDateRaw(s); } catch { return false; } };
const isSaturday = (day: string) => dowOf(day) === 6;
const dayOr = (day: string | undefined, name = 'day') => {
  const d = day ?? lifeToday();
  if (!isDate(d)) bad(`${name} must be YYYY-MM-DD`);
  return d;
};
const text = (v: unknown, name: string, max: number, min = 1) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min) bad(`${name} is required`);
  if (s.length > max) bad(`${name} max ${max} characters`);
  return s;
};
const optDate = (v: unknown, name: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) bad(`${name} must be YYYY-MM-DD`);
  return v as string;
};
const intIn = (v: unknown, name: string, lo: number, hi: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) bad(`${name} must be a whole number ${lo}–${hi}`);
  return n;
};

// =====================================================================================================
// 1. Promises ledger: "I told X I would do Y by D".
// =====================================================================================================
export type PromiseStatus = 'open' | 'kept' | 'released';
export type PromiseRow = { id: string; who: string; what: string; due: string | null; source: string | null; task_id: string | null;
  status: PromiseStatus; closed_day: string | null; closed_at: string | null; created_at: string; updated_at: string };
export type PromiseInput = { id?: string; who: string; what: string; due?: string | null; source?: string | null; task_id?: string | null };

const getPromise = (id: string) => need(one<PromiseRow>(`SELECT * FROM promises WHERE id = ? AND deleted_at IS NULL`, id), 'promise');

/** Record a promise. task_id (optional) must be an existing task. */
export const addPromise = (p: PromiseInput): PromiseRow => {
  const row = {
    id: idOr(p.id),
    who: text(p.who, 'who', 80),
    what: text(p.what, 'what', 300),
    due: optDate(p.due, 'due'),
    source: p.source ? text(p.source, 'source', 80) : null,
    task_id: p.task_id ? tasks.resolveRef(p.task_id).id : null,
    status: 'open',
  };
  insert('promises', row);
  return getPromise(row.id);
};

export const listPromises = (status: PromiseStatus | 'all' = 'open', limit = 100): PromiseRow[] => {
  if (!['open', 'kept', 'released', 'all'].includes(status)) bad('status must be open, kept, released or all');
  return all<PromiseRow>(`SELECT * FROM promises WHERE deleted_at IS NULL AND (? = 'all' OR status = ?)
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due IS NULL, due, created_at DESC LIMIT ?`,
    status, status, Math.min(Math.max(limit, 1), 500));
};

export const updatePromise = (id: string, f: Partial<PromiseInput>): PromiseRow => {
  getPromise(id);
  const row: Row = {};
  if (f.who !== undefined) row.who = text(f.who, 'who', 80);
  if (f.what !== undefined) row.what = text(f.what, 'what', 300);
  if (f.due !== undefined) row.due = optDate(f.due, 'due');
  if (f.source !== undefined) row.source = f.source ? text(f.source, 'source', 80) : null;
  if (f.task_id !== undefined) row.task_id = f.task_id ? tasks.resolveRef(f.task_id).id : null;
  patch('promises', id, row);
  return getPromise(id);
};

const closePromise = (id: string, status: 'kept' | 'released', day?: string) => {
  const p = getPromise(id);
  if (p.status === status) return p; // idempotent
  patch('promises', id, { status, closed_day: dayOr(day), closed_at: now() });
  return getPromise(id);
};
/** Mark a promise kept. */
export const keepPromise = (id: string, day?: string) => closePromise(id, 'kept', day);
/** Let a promise go. It is simply closed: no record of anything owed. */
export const releasePromise = (id: string, day?: string) => closePromise(id, 'released', day);
/** Back to open (undo kept/released). */
export const reopenPromise = (id: string) => {
  getPromise(id);
  patch('promises', id, { status: 'open', closed_day: null, closed_at: null });
  return getPromise(id);
};
export const deletePromise = (id: string) => { getPromise(id); softDelete('promises', id); return { id, deleted: true }; };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Mon 9 Nov */
export const humanDate = (d: string) => `${DOW[dowOf(d)]} ${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
/** Plain words, no 'overdue': 'in 2 days', 'today', 'yesterday', 'from Mon 9 Nov'. */
export const promiseWhen = (n: number, due: string) =>
  n > 1 ? `in ${n} days` : n === 1 ? 'tomorrow' : n === 0 ? 'today' : n === -1 ? 'yesterday' : `from ${humanDate(due)}`;

/** Open promises with a due date within 2 days of `day` (earlier dates included). Empty on Saturday for nudges and Today (screen=true still lists). */
export const promisesSoon = (day?: string, screen = false) => {
  const d = dayOr(day);
  if (isSaturday(d) && !screen) return [];
  return all<PromiseRow>(`SELECT * FROM promises WHERE deleted_at IS NULL AND status = 'open' AND due IS NOT NULL AND due <= ?
      ORDER BY due, created_at`, addDays(d, 2))
    .map((p) => {
      const n = daysBetween(d, p.due!);
      return { ...p, days_until: n, when: promiseWhen(n, p.due!) };
    });
};

// =====================================================================================================
// 2. Tiny habit: the smallest version that still counts. Checks are flagged tiny or full. No streaks.
// =====================================================================================================
/** Set (or clear with empty text) a habit's tiny version, e.g. "1 page". */
export const setTiny = (habitRef: string, tiny: string | null) => {
  const h = tasks.findHabit(habitRef);
  const t = tiny === null || String(tiny).trim() === '' ? null : text(tiny, 'tiny', 80);
  if (t === null) {
    run(`UPDATE habit_tiny SET deleted_at = ?, updated_at = ? WHERE habit_id = ? AND deleted_at IS NULL`, now(), now(), h.id);
    return { habit_id: h.id, tiny: null };
  }
  const ts = now();
  run(`INSERT INTO habit_tiny (id, habit_id, tiny, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (habit_id) DO UPDATE SET tiny = excluded.tiny, updated_at = excluded.updated_at, deleted_at = NULL`,
    idOr(), h.id, t, ts, ts);
  return { habit_id: h.id, tiny: t };
};

/** The tiny version for a habit, or null. */
export const tinyFor = (habitId: string): string | null => {
  const h = tasks.findHabit(habitId);
  return one<{ tiny: string }>(`SELECT tiny FROM habit_tiny WHERE habit_id = ? AND deleted_at IS NULL`, h.id)?.tiny ?? null;
};

const setKind = (habitId: string, day: string, kind: 'tiny' | 'full') => {
  const ts = now();
  run(`INSERT INTO habit_check_kind (id, habit_id, day, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (habit_id, day) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at, deleted_at = NULL`,
    idOr(), habitId, day, kind, ts, ts);
};

/** Check the habit for the day (in habit_checks) and flag it as the tiny version. */
export const checkTiny = (habitRef: string, day?: string) => {
  const d = dayOr(day);
  const h = tasks.findHabit(habitRef);
  const c = tasks.checkHabit(h.id, d, 1);
  setKind(h.id, d, 'tiny');
  return { ...c, kind: 'tiny' as const, tiny: tinyFor(h.id) };
};

/** Check the habit for the day as the full version (clears a tiny flag). */
export const checkFull = (habitRef: string, day?: string) => {
  const d = dayOr(day);
  const h = tasks.findHabit(habitRef);
  const c = tasks.checkHabit(h.id, d, 1);
  setKind(h.id, d, 'full');
  return { ...c, kind: 'full' as const };
};

/** Counts of checked days in [from, to]: tiny vs full. Checks without a flag count as full. No streaks. */
export const tinyStats = (habitRef: string, from: string, to: string) => {
  if (!isDate(from) || !isDate(to)) bad('from and to must be YYYY-MM-DD');
  const h = tasks.findHabit(habitRef);
  const rows = all<{ day: string; kind: string | null }>(`SELECT c.day, k.kind FROM habit_checks c
      LEFT JOIN habit_check_kind k ON k.habit_id = c.habit_id AND k.day = c.day AND k.deleted_at IS NULL
      WHERE c.habit_id = ? AND c.deleted_at IS NULL AND c.count > 0 AND c.day >= ? AND c.day <= ?`, h.id, from, to);
  const tiny = rows.filter((r) => r.kind === 'tiny').length;
  return { habit_id: h.id, from, to, days_checked: rows.length, tiny, full: rows.length - tiny };
};

// =====================================================================================================
// 3. Time capsule: a note to future self, sealed until its open date.
// =====================================================================================================
type CapsuleRow = { id: string; title: string; body: string; written_day: string; open_on: string; opened_at: string | null;
  created_at: string; updated_at: string };
const capsuleView = (c: CapsuleRow, day: string) => {
  const sealed = c.open_on > day;
  return { id: c.id, title: c.title, written_day: c.written_day, open_on: c.open_on, opened_at: c.opened_at, sealed,
    body: sealed ? null : c.body };
};

/** Write a capsule opening on open_on, or in_days after `today`. */
export const writeCapsule = (c: { id?: string; body: string; title?: string; open_on?: string; in_days?: number }, today?: string) => {
  const d = dayOr(today, 'today');
  const body = String(c.body ?? '').trim();
  if (!body) bad('body is required');
  if (body.length > 8000) bad('body max 8000 characters');
  let open: string;
  if (c.open_on !== undefined && c.open_on !== null) {
    if (!isDate(c.open_on)) bad('open_on must be YYYY-MM-DD');
    open = c.open_on;
  } else if (c.in_days !== undefined && c.in_days !== null) open = addDays(d, intIn(c.in_days, 'in_days', 1, 3650));
  else return bad('open_on or in_days is required');
  if (open <= d) bad('open_on must be after today');
  const row = { id: idOr(c.id), title: c.title ? text(c.title, 'title', 120) : '', body, written_day: d, open_on: open };
  insert('capsules', row);
  return capsuleView(need(one<CapsuleRow>(`SELECT * FROM capsules WHERE id = ?`, row.id), 'capsule'), d);
};

/** All capsules; sealed ones come without their body. */
export const listCapsules = (day?: string) => {
  const d = dayOr(day);
  return all<CapsuleRow>(`SELECT * FROM capsules WHERE deleted_at IS NULL ORDER BY open_on`).map((c) => capsuleView(c, d));
};

export const getCapsule = (id: string, day?: string) =>
  capsuleView(need(one<CapsuleRow>(`SELECT * FROM capsules WHERE id = ? AND deleted_at IS NULL`, id), 'capsule'), dayOr(day));

/** Unopened capsules whose open date has come. Empty on Saturday for nudges and Today (screen=true still lists). */
export const capsulesDue = (day?: string, screen = false) => {
  const d = dayOr(day);
  if (isSaturday(d) && !screen) return [];
  return all<CapsuleRow>(`SELECT * FROM capsules WHERE deleted_at IS NULL AND opened_at IS NULL AND open_on <= ? ORDER BY open_on`, d)
    .map((c) => capsuleView(c, d));
};

/** Open a capsule (marks opened). Refused while still sealed. */
export const openCapsule = (id: string, day?: string) => {
  const d = dayOr(day);
  const c = need(one<CapsuleRow>(`SELECT * FROM capsules WHERE id = ? AND deleted_at IS NULL`, id), 'capsule');
  if (c.open_on > d) bad(`sealed until ${c.open_on}`);
  if (!c.opened_at) patch('capsules', id, { opened_at: now() });
  return capsuleView(need(one<CapsuleRow>(`SELECT * FROM capsules WHERE id = ?`, id), 'capsule'), d);
};

export const deleteCapsule = (id: string) => {
  need(one(`SELECT id FROM capsules WHERE id = ? AND deleted_at IS NULL`, id), 'capsule');
  softDelete('capsules', id);
  return { id, deleted: true };
};

// =====================================================================================================
// 4. People light: family and friends only.
// =====================================================================================================
export const RELATIONS = ['family', 'friend', 'other'] as const;
export type Relation = typeof RELATIONS[number];
const MD_RE = /^(\d{2})-(\d{2})$/;
const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validMd = (md: string) => {
  const m = MD_RE.exec(md);
  if (!m) return false;
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DIM[mo - 1];
};
/** MM-DD or YYYY-MM-DD (a real date, Feb 29 allowed in MM-DD). */
const birthdayOf = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (validMd(s) || isDate(s)) return s;
  return bad('birthday must be MM-DD or YYYY-MM-DD');
};
const relationOf = (v: unknown): Relation => {
  const s = String(v ?? 'other').trim().toLowerCase();
  if (!(RELATIONS as readonly string[]).includes(s)) bad('relation must be family, friend or other');
  return s as Relation;
};

export type PersonRow = { id: string; name: string; relation: Relation; birthday: string | null; last_contact: string | null;
  cadence_days: number | null; note: string; created_at: string; updated_at: string; phone?: string | null };
export type PersonInput = { id?: string; name: string; relation?: string; birthday?: string | null; last_contact?: string | null;
  cadence_days?: number | null; note?: string; phone?: string | null };
/** Phone for tel: and WhatsApp links. Digits, spaces, + ( ) . - only. */
const phoneOf = (v: unknown): string | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^[+\d][\d\s().-]{5,24}$/.test(s)) bad('phone must look like +213 555 12 34 56');
  return s;
};

const getPerson = (id: string) => need(one<PersonRow>(`SELECT * FROM people WHERE id = ? AND deleted_at IS NULL`, id), 'person');
/** By id or exact name (case-insensitive). */
export const findPerson = (ref: string) => need(one<PersonRow>(
  `SELECT * FROM people WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?)) ORDER BY created_at LIMIT 1`, ref, ref), `person ${ref}`);

export const addPerson = (p: PersonInput): PersonRow => {
  const row = {
    id: idOr(p.id), name: text(p.name, 'name', 80), relation: relationOf(p.relation),
    birthday: birthdayOf(p.birthday), last_contact: optDate(p.last_contact, 'last_contact'),
    cadence_days: p.cadence_days === undefined || p.cadence_days === null ? null : intIn(p.cadence_days, 'cadence_days', 1, 3650),
    note: p.note ? String(p.note).trim().slice(0, 500) : '', phone: phoneOf(p.phone),
  };
  insert('people', row);
  return getPerson(row.id);
};

export const updatePerson = (ref: string, f: Partial<PersonInput>): PersonRow => {
  const cur = findPerson(ref);
  const row: Row = {};
  if (f.name !== undefined) row.name = text(f.name, 'name', 80);
  if (f.relation !== undefined) row.relation = relationOf(f.relation);
  if (f.birthday !== undefined) row.birthday = birthdayOf(f.birthday);
  if (f.last_contact !== undefined) row.last_contact = optDate(f.last_contact, 'last_contact');
  if (f.cadence_days !== undefined) row.cadence_days = f.cadence_days === null ? null : intIn(f.cadence_days, 'cadence_days', 1, 3650);
  if (f.note !== undefined) row.note = String(f.note ?? '').trim().slice(0, 500);
  if (f.phone !== undefined) row.phone = phoneOf(f.phone);
  patch('people', cur.id, row);
  return getPerson(cur.id);
};

export const listPeople = (relation?: string) => {
  if (relation !== undefined) relationOf(relation);
  return all<PersonRow>(`SELECT * FROM people WHERE deleted_at IS NULL ${relation ? 'AND relation = ?' : ''} ORDER BY lower(name)`,
    ...(relation ? [relation.toLowerCase()] : []));
};

export const deletePerson = (ref: string) => { const p = findPerson(ref); softDelete('people', p.id); return { id: p.id, deleted: true }; };

/** Log a contact. last_contact moves forward only (an older log does not move it back). */
export const touch = (personRef: string, day?: string, note = '') => {
  const d = dayOr(day);
  const p = findPerson(personRef);
  insert('person_contacts', { id: idOr(), person_id: p.id, day: d, note: String(note ?? '').trim().slice(0, 300) });
  if (!p.last_contact || d > p.last_contact) patch('people', p.id, { last_contact: d });
  return getPerson(p.id);
};

export const contactsOf = (personRef: string, limit = 50) => {
  const p = findPerson(personRef);
  return all<Row>(`SELECT id, day, note FROM person_contacts WHERE person_id = ? AND deleted_at IS NULL ORDER BY day DESC LIMIT ?`,
    p.id, Math.min(Math.max(limit, 1), 500));
};

/** 1..cadence, fixed per person (a small hash of the id). */
export const firstDueOffset = (id: string, cadence: number) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1 + (h % Math.max(1, cadence));
};
/** People with a cadence whose last contact + cadence ≤ day. No last contact → counted from when added. Empty on Saturday for nudges and Today (screen=true still lists). */
export const peopleDue = (day?: string, screen = false) => {
  const d = dayOr(day);
  if (isSaturday(d) && !screen) return [];
  return all<PersonRow>(`SELECT * FROM people WHERE deleted_at IS NULL AND cadence_days IS NOT NULL ORDER BY lower(name)`)
    .map((p) => {
      const since = p.last_contact ?? lifeDay(new Date(p.created_at));
      // No contact logged yet: spread the first nudge over the cadence so ten people added together do not all come due the same day.
      const next_on = p.last_contact ? addDays(since, p.cadence_days!) : addDays(since, firstDueOffset(p.id, p.cadence_days!));
      return { ...p, since, next_on, days_since: daysBetween(since, d) };
    })
    .filter((p) => p.next_on <= d)
    .sort((a, b) => a.next_on.localeCompare(b.next_on))
    .map((p) => ({ id: p.id, name: p.name, relation: p.relation, last_contact: p.last_contact, cadence_days: p.cadence_days,
      days_since: p.days_since, phone: p.phone ?? null, note: 'Could reach out' }));
};

// =====================================================================================================
// 5. Occasions: yearly dates (MM-DD). Feb 29 shows on Feb 28 in non-leap years. Shown on Saturday too.
// =====================================================================================================
export type OccasionRow = { id: string; name: string; kind: string; md: string; year: number | null; person_id: string | null;
  lead_days: number; note: string; created_at: string; updated_at: string };
export type OccasionInput = { id?: string; name: string; kind?: string; md?: string; date?: string; year?: number | null;
  person_id?: string | null; lead_days?: number; note?: string };
const KINDS = ['birthday', 'anniversary', 'other'];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** The date of a MM-DD in a given year (Feb 29 → Feb 28 in non-leap years). */
export const dateInYear = (md: string, year: number) =>
  md === '02-29' && !isLeap(year) ? `${year}-02-28` : `${year}-${md}`;
/** Next date on or after `day` for a yearly MM-DD. */
export const nextOccurrence = (md: string, day: string) => {
  const y = Number(day.slice(0, 4));
  const d = dateInYear(md, y);
  return d >= day ? d : dateInYear(md, y + 1);
};

const getOccasion = (id: string) => need(one<OccasionRow>(`SELECT * FROM occasions WHERE id = ? AND deleted_at IS NULL`, id), 'occasion');

/** md = MM-DD, or date = YYYY-MM-DD (sets md and year). */
export const addOccasion = (o: OccasionInput): OccasionRow => {
  let md = o.md ?? null;
  let year = o.year ?? null;
  const kind = String(o.kind ?? 'other').toLowerCase();
  if (!KINDS.includes(kind)) bad(`kind must be one of ${KINDS.join(', ')}`);
  const name = text(o.name, 'name', 120);
  if (o.date) {
    if (!isDate(o.date)) bad('date must be YYYY-MM-DD');
    md = o.date.slice(5);
    year = Number(o.date.slice(0, 4));
  }
  if (!md || !validMd(md)) bad('md must be MM-DD');
  if (year !== null) intIn(year, 'year', 1900, 2200);
  const row = {
    id: idOr(o.id), name, kind, md, year,
    person_id: o.person_id ? findPerson(o.person_id).id : null,
    lead_days: o.lead_days === undefined ? 7 : intIn(o.lead_days, 'lead_days', 0, 90),
    note: o.note ? String(o.note).trim().slice(0, 300) : '',
  };
  insert('occasions', row);
  return getOccasion(row.id);
};

export const updateOccasion = (id: string, f: Partial<OccasionInput>) => {
  const cur = getOccasion(id);
  const row: Row = {};
  if (f.name !== undefined) row.name = text(f.name, 'name', 120);
  if (f.md !== undefined) { if (!validMd(f.md)) bad('md must be MM-DD'); row.md = f.md; }
  if (f.year !== undefined) row.year = f.year === null ? null : intIn(f.year, 'year', 1900, 2200);
  if (f.kind !== undefined) { const k = String(f.kind).toLowerCase(); if (!KINDS.includes(k)) bad(`kind must be one of ${KINDS.join(', ')}`); row.kind = k; }
  if (f.person_id !== undefined) row.person_id = f.person_id ? findPerson(f.person_id).id : null;
  if (f.lead_days !== undefined) row.lead_days = intIn(f.lead_days, 'lead_days', 0, 90);
  if (f.note !== undefined) row.note = String(f.note ?? '').trim().slice(0, 300);
  patch('occasions', cur.id, row);
  return getOccasion(cur.id);
};

export const listOccasions = () => all<OccasionRow>(`SELECT * FROM occasions WHERE deleted_at IS NULL ORDER BY md`);
export const deleteOccasion = (id: string) => { getOccasion(id); softDelete('occasions', id); return { id, deleted: true }; };

/**
 * Occasions within `within` days (or within the occasion's own lead_days if larger), plus birthdays stored on people.
 * Sorted by days_until. Not quiet on Saturday.
 */
export const occasionsSoon = (day?: string, within = 14) => {
  const d = dayOr(day);
  const w = intIn(within, 'within', 0, 366);
  type Soon = { id: string; source: 'occasion' | 'person'; name: string; kind: string; date: string; days_until: number;
    person_id: string | null; person_name: string | null; years: number | null };
  const out: Soon[] = [];
  const names = new Map(all<{ id: string; name: string }>(`SELECT id, name FROM people WHERE deleted_at IS NULL`).map((p) => [p.id, p.name]));
  const covered = new Set<string>();
  for (const o of listOccasions()) {
    const date = nextOccurrence(o.md, d);
    const n = daysBetween(d, date);
    if (o.kind === 'birthday' && o.person_id) covered.add(o.person_id);
    if (n > Math.max(w, o.lead_days)) continue;
    out.push({ id: o.id, source: 'occasion', name: o.name, kind: o.kind, date, days_until: n, person_id: o.person_id,
      person_name: o.person_id ? names.get(o.person_id) ?? null : null, years: o.year ? Number(date.slice(0, 4)) - o.year : null });
  }
  for (const p of all<PersonRow>(`SELECT * FROM people WHERE deleted_at IS NULL AND birthday IS NOT NULL`)) {
    if (covered.has(p.id)) continue;
    const md = p.birthday!.length === 10 ? p.birthday!.slice(5) : p.birthday!;
    const date = nextOccurrence(md, d);
    const n = daysBetween(d, date);
    if (n > w) continue;
    const by = p.birthday!.length === 10 ? Number(p.birthday!.slice(0, 4)) : null;
    out.push({ id: p.id, source: 'person', name: `${p.name}'s birthday`, kind: 'birthday', date, days_until: n, person_id: p.id,
      person_name: p.name, years: by ? Number(date.slice(0, 4)) - by : null });
  }
  return out.sort((a, b) => a.days_until - b.days_until || a.name.localeCompare(b.name));
};

// =====================================================================================================
// 6. Waiting check-on: when to look again at a task that waits on someone.
// =====================================================================================================
export const WAITING_DEFAULT_DAYS = 5;
type WaitRow = { id: string; task_id: string; check_on: string; waiting_for: string | null; auto: number; updated_at: string };

const waitingTasks = () => all<Row>(`SELECT id, title, waiting_for, updated_at FROM tasks
    WHERE status = 'open' AND deleted_at IS NULL AND waiting_for IS NOT NULL ORDER BY created_at`);

/** Row for a waiting task; creates the default (5 days after waiting was set) when none, or when the wait changed. */
const ensureWait = (t: Row): WaitRow => {
  const cur = one<WaitRow>(`SELECT * FROM waiting_checks WHERE task_id = ?`, t.id);
  const touched = lifeDay(new Date(t.updated_at));
  // An auto date goes stale when the task was touched after it was set (a follow-up): count again from that touch.
  const stale = !!cur && !!cur.auto && cur.check_on < addDays(touched, WAITING_DEFAULT_DAYS) && String(t.updated_at) > cur.updated_at;
  if (cur && !(cur.auto && cur.waiting_for !== t.waiting_for) && !stale) return cur;
  const check_on = addDays(touched, WAITING_DEFAULT_DAYS);
  const ts = now();
  run(`INSERT INTO waiting_checks (id, task_id, check_on, waiting_for, auto, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET check_on = excluded.check_on, waiting_for = excluded.waiting_for, auto = 1,
       updated_at = excluded.updated_at, deleted_at = NULL`, idOr(), t.id, check_on, t.waiting_for, ts, ts);
  return need(one<WaitRow>(`SELECT * FROM waiting_checks WHERE task_id = ?`, t.id), 'waiting check');
};

/** Set when to check on a waiting task: an explicit day, or in_days after today. */
export const setCheckOn = (taskRef: string, o: { day?: string; in_days?: number }, today?: string) => {
  const t = tasks.resolveRef(taskRef);
  if (!t.waiting_for) bad('task is not waiting on anyone (set waiting_for first)');
  const base = dayOr(today, 'today');
  let check_on: string;
  if (o.day !== undefined) { if (!isDate(o.day)) bad('day must be YYYY-MM-DD'); check_on = o.day; }
  else if (o.in_days !== undefined) check_on = addDays(base, intIn(o.in_days, 'in_days', 0, 365));
  else return bad('day or in_days is required');
  const ts = now();
  run(`INSERT INTO waiting_checks (id, task_id, check_on, waiting_for, auto, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET check_on = excluded.check_on, waiting_for = excluded.waiting_for, auto = 0,
       updated_at = excluded.updated_at, deleted_at = NULL`, idOr(), t.id, check_on, t.waiting_for, ts, ts);
  return { task_id: t.id, title: t.title, waiting_for: t.waiting_for, check_on, auto: false };
};

/** All open waiting tasks with their check-on day (defaults filled in). */
export const waitingList = () => waitingTasks().map((t) => {
  const w = ensureWait(t);
  return { task_id: String(t.id), title: String(t.title), waiting_for: String(t.waiting_for), check_on: w.check_on, auto: !!w.auto };
});

/** Waiting tasks whose check-on day ≤ day. Empty on Saturday for nudges and Today (screen=true still lists). */
export const waitingDue = (day?: string, screen = false) => {
  const d = dayOr(day);
  if (isSaturday(d) && !screen) return [];
  return waitingList().filter((w) => w.check_on <= d).sort((a, b) => a.check_on.localeCompare(b.check_on))
    .map((w) => ({ ...w, note: 'Could check in' }));
};

// =====================================================================================================
// 7 + 8. Week facts and the 14-day strip. Facts only: counts and sums, no scores.
// =====================================================================================================
const hasTable = (name: string) => !!one(`SELECT 1 AS x FROM sqlite_master WHERE type IN ('table','view') AND name = ?`, name);
const hasColumn = (table: string, col: string) => all<{ name: string }>(`PRAGMA table_info(${table})`).some((c) => c.name === col);

type DayFacts = { tasks_done: number; focus_min: number; gym: number; habits_checked: number; expenses: number;
  spend_usd: number; food_logged: boolean; promises_kept: number };

/** Per life-day facts for [from, to] inclusive. Timestamps are bucketed with lifeDay (day rolls at 04:00). */
const factsByDay = (from: string, to: string) => {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const m = new Map<string, DayFacts>(days.map((d) => [d, { tasks_done: 0, focus_min: 0, gym: 0, habits_checked: 0, expenses: 0,
    spend_usd: 0, food_logged: false, promises_kept: 0 }]));
  const lo = addDays(from, -1), hi = addDays(to, 2); // loose string window, exact bucketing below
  const bump = (iso: string | null, f: (x: DayFacts) => void) => {
    if (!iso) return;
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return;
    const x = m.get(lifeDay(t));
    if (x) f(x);
  };
  const at = (day: string, f: (x: DayFacts) => void) => { const x = m.get(day); if (x) f(x); };

  if (hasTable('tasks')) {
    for (const r of all<{ done_at: string }>(`SELECT done_at FROM tasks WHERE status = 'done' AND deleted_at IS NULL AND done_at >= ? AND done_at < ?`, lo, hi))
      bump(r.done_at, (x) => { x.tasks_done++; });
  }
  if (hasTable('focus_sessions')) {
    for (const r of all<{ started_at: string; minutes: number }>(`SELECT started_at, minutes FROM focus_sessions
        WHERE deleted_at IS NULL AND started_at >= ? AND started_at < ?`, lo, hi))
      bump(r.started_at, (x) => { x.focus_min += Number(r.minutes) || 0; });
  }
  if (hasTable('workouts')) {
    for (const r of all<{ day: string; n: number }>(`SELECT day, COUNT(*) AS n FROM workouts WHERE deleted_at IS NULL AND day >= ? AND day <= ? GROUP BY day`, from, to))
      at(r.day, (x) => { x.gym += r.n; });
  }
  if (hasTable('habit_checks')) {
    for (const r of all<{ day: string; n: number }>(`SELECT day, COUNT(*) AS n FROM habit_checks WHERE deleted_at IS NULL AND count > 0
        AND day >= ? AND day <= ? GROUP BY day`, from, to))
      at(r.day, (x) => { x.habits_checked += r.n; });
  }
  if (hasTable('records') && hasTable('accounts')) {
    for (const r of all<{ day: string; n: number; usd: number }>(`SELECT r.day, COUNT(*) AS n, COALESCE(SUM(r.usd), 0) AS usd
        FROM records r JOIN accounts a ON a.id = r.account_id
        WHERE r.deleted_at IS NULL AND r.kind = 'expense' AND a.track = 'personal' AND r.day >= ? AND r.day <= ? GROUP BY r.day`, from, to))
      at(r.day, (x) => { x.expenses += r.n; x.spend_usd += r.usd; });
  }
  if (hasTable('food_log')) {
    for (const r of all<{ day: string }>(`SELECT DISTINCT day FROM food_log WHERE deleted_at IS NULL AND day >= ? AND day <= ?`, from, to))
      at(r.day, (x) => { x.food_logged = true; });
  }
  if (hasTable('day_status')) {
    for (const r of all<{ day: string }>(`SELECT day FROM day_status WHERE status IN ('complete','partial') AND day >= ? AND day <= ?`, from, to))
      at(r.day, (x) => { x.food_logged = true; });
  }
  if (hasTable('promises') && hasColumn('promises', 'closed_day')) {
    for (const r of all<{ closed_day: string; n: number }>(`SELECT closed_day, COUNT(*) AS n FROM promises WHERE deleted_at IS NULL
        AND status = 'kept' AND closed_day >= ? AND closed_day <= ? GROUP BY closed_day`, from, to))
      at(r.closed_day, (x) => { x.promises_kept += r.n; });
  }
  return { days, m };
};

/** Neutral counts for the week starting weekStart (normalised to its Monday). */
export const weekFacts = (weekStart?: string) => {
  const ws = weekStartOf(dayOr(weekStart, 'weekStart'));
  const we = addDays(ws, 6);
  const { m } = factsByDay(ws, we);
  const v = [...m.values()];
  const sum = (f: (x: DayFacts) => number) => v.reduce((s, x) => s + f(x), 0);
  return {
    week_start: ws, week_end: we,
    tasks_done: sum((x) => x.tasks_done),
    focus_minutes: sum((x) => x.focus_min),
    habit_checks: sum((x) => x.habits_checked),
    gym_workouts: sum((x) => x.gym),
    expenses: sum((x) => x.expenses),
    spend_personal_usd: round(sum((x) => x.spend_usd), 2),
    food_days_logged: v.filter((x) => x.food_logged).length,
    promises_kept: sum((x) => x.promises_kept),
  };
};

/** The 14 life-days ending at endDay (oldest first). */
export const strip14 = (endDay?: string) => {
  const end = dayOr(endDay, 'endDay');
  const { days, m } = factsByDay(addDays(end, -13), end);
  return days.map((day) => {
    const x = m.get(day)!;
    return { day, tasks_done: x.tasks_done, focus_min: x.focus_min, gym: x.gym > 0, habits_checked: x.habits_checked,
      spend_usd: round(x.spend_usd, 2), food_logged: x.food_logged };
  });
};
