// Food: local food DB (Ciqual/USDA/OFF/own) with FTS search, diary, recipes, water, day status, targets,
// adaptive TDEE check-in. Replaces MyFitnessPal. All nutrition numbers are estimates.
import { createHash } from 'node:crypto';
import { AppError } from '../../errors.ts';
import { addDays, hhmm, isDate, lifeDay, lifeToday, zonedIso } from '../../time.ts';
import { all, idOr, insert, j, need, now, one, parseCsv, patch, round, run, softDelete, uuid, type Row } from '../util.ts';
import { dailyWeights, estimateFromProfile, trend } from '../body/store.ts';

const bad = (m: string): never => { throw new AppError('bad_request', m); };
const sha = (s: string) => createHash('sha1').update(s).digest('hex');
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks', 'late'] as const;
export const SOURCES = ['ciqual', 'usda', 'off', 'own', 'estimated'] as const;
export const KCAL_FLOOR = 1500;

export type Food = {
  id: string; source: string; source_ref: string | null; barcode: string | null; name: string; brand: string | null;
  kcal: number; protein: number; carbs: number; fat: number; sat_fat: number | null; fiber: number | null;
  sugar: number | null; sodium: number | null; density: number | null; state: string | null; flags: string[]; uses: number;
  servings?: { label: string; grams: number }[];
};
type FoodIn = Partial<Omit<Food, 'flags' | 'uses' | 'servings'>> & { name: string; kcal: number; servings?: { label: string; grams: number }[] };

// ---------- sanity ----------
/** Flags for bad-looking rows (shown, never hidden): kcal vs macros off by > 15%, kcal > 900/100 g, macro > 100 g. */
export const sanity = (f: { kcal: number; protein?: number; carbs?: number; fat?: number; fiber?: number | null }) => {
  const flags: string[] = [];
  const p = f.protein ?? 0, c = f.carbs ?? 0, fat = f.fat ?? 0;
  if (f.kcal > 900) flags.push('kcal_over_900');
  if (p > 100 || c > 100 || fat > 100 || p + c + fat > 100.5) flags.push('macros_over_100g');
  const calc = 4 * p + 4 * c + 9 * fat;
  // fiber counted as carbs in some sources (2 kcal/g); give it slack
  const slack = (f.fiber ?? 0) * 2;
  if (f.kcal >= 20 && Math.abs(calc - f.kcal) > Math.max(0.15 * f.kcal, slack + 5)) flags.push('kcal_macro_mismatch');
  if (f.kcal < 20 && calc > 40) flags.push('kcal_macro_mismatch');
  return flags;
};

const rowToFood = (r: Row): Food => ({ ...(r as unknown as Food), flags: j<string[]>(r.flags, []) });

// ---------- foods ----------
export const addFood = (f: FoodIn): Food => {
  const name = String(f.name ?? '').trim().slice(0, 200);
  if (!name) bad('name is needed');
  const source = f.source ?? 'own';
  if (!SOURCES.includes(source as never)) bad(`source must be one of ${SOURCES.join(', ')}`);
  const kcal = Number(f.kcal);
  if (!Number.isFinite(kcal) || kcal < 0) bad('kcal per 100 g must be >= 0');
  for (const k of ['protein', 'carbs', 'fat'] as const) if (f[k] !== undefined && !(Number(f[k]) >= 0)) bad(`${k} must be >= 0`);
  if (f.barcode && !/^\d{6,14}$/.test(String(f.barcode))) bad('barcode must be 6-14 digits');
  if (f.source_ref) {
    const ex = one<Row>('SELECT * FROM foods WHERE source = ? AND source_ref = ?', source, f.source_ref);
    if (ex) return getFood(String(ex.id));
  }
  const id = idOr(f.id);
  const row = {
    id, source, source_ref: f.source_ref ?? null, barcode: f.barcode ?? null, name, brand: f.brand?.trim() || null,
    kcal: round(kcal, 1), protein: round(Number(f.protein ?? 0), 2), carbs: round(Number(f.carbs ?? 0), 2), fat: round(Number(f.fat ?? 0), 2),
    sat_fat: f.sat_fat ?? null, fiber: f.fiber ?? null, sugar: f.sugar ?? null, sodium: f.sodium ?? null,
    density: f.density ?? null, state: f.state ?? null,
  };
  if (insert('foods', { ...row, flags: sanity(row) })) {
    run('INSERT INTO foods_fts (name, brand, food_id) VALUES (?, ?, ?)', name, row.brand ?? '', id);
    for (const s of f.servings ?? []) addServing(id, s.label, s.grams);
  }
  return getFood(id);
};

export const getFood = (id: string): Food => {
  const r = need(one<Row>('SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL', id), 'food');
  return { ...rowToFood(r), servings: all<{ label: string; grams: number }>('SELECT label, grams FROM servings WHERE food_id = ? ORDER BY grams', id) };
};

export const updateFood = (id: string, f: Partial<FoodIn>) => {
  const cur = getFood(id);
  if (cur.source !== 'own' && cur.source !== 'estimated') {
    // Never mutate source rows: make an own override instead.
    return addFood({ ...cur, ...f, id: undefined, source: 'own', source_ref: null, barcode: f.barcode ?? cur.barcode, servings: cur.servings } as FoodIn);
  }
  const next = { ...cur, ...f };
  patch('foods', id, { name: next.name, brand: next.brand, kcal: next.kcal, protein: next.protein, carbs: next.carbs, fat: next.fat,
    sat_fat: next.sat_fat, fiber: next.fiber, sugar: next.sugar, sodium: next.sodium, barcode: next.barcode, flags: sanity(next) });
  run('DELETE FROM foods_fts WHERE food_id = ?', id);
  run('INSERT INTO foods_fts (name, brand, food_id) VALUES (?, ?, ?)', next.name, next.brand ?? '', id);
  return getFood(id);
};

export const deleteFood = (id: string) => { softDelete('foods', id); run('DELETE FROM foods_fts WHERE food_id = ?', id); };

export const addServing = (food_id: string, label: string, grams: number) => {
  const l = String(label ?? '').trim().slice(0, 60);
  if (!l) bad('serving label is needed');
  if (!(grams > 0 && grams < 5000)) bad('serving grams must be 0-5000');
  run('INSERT INTO servings (food_id, label, grams) VALUES (?, ?, ?) ON CONFLICT (food_id, label) DO UPDATE SET grams = excluded.grams', food_id, l, grams);
};

/** Search: own foods first, then most used, then source. FTS trigram for >= 3 chars, LIKE for shorter. */
export const searchFoods = (q: string, limit = 25): Food[] => {
  const s = String(q ?? '').trim();
  if (!s) return all<Row>(`SELECT * FROM foods WHERE deleted_at IS NULL ORDER BY uses DESC, (source = 'own') DESC, name LIMIT ?`, limit).map(rowToFood);
  if (/^\d{6,14}$/.test(s)) { const b = byBarcode(s); return b ? [b] : []; }
  const order = `ORDER BY (f.source = 'own') DESC, f.uses DESC, (f.flags = '[]') DESC, length(f.name), f.name LIMIT ?`;
  if (s.length < 3) {
    return all<Row>(`SELECT f.* FROM foods f WHERE f.deleted_at IS NULL AND (f.name LIKE ? OR f.brand LIKE ?) ${order}`, `%${s}%`, `%${s}%`, limit).map(rowToFood);
  }
  const terms = s.split(/\s+/).filter((t) => t.length >= 3).map((t) => `"${t.replace(/"/g, '""')}"`);
  const short = s.split(/\s+/).filter((t) => t.length < 3);
  const likes = short.map(() => ' AND (f.name LIKE ? OR f.brand LIKE ?)').join('');
  return all<Row>(`SELECT f.* FROM foods_fts x JOIN foods f ON f.id = x.food_id WHERE foods_fts MATCH ? AND f.deleted_at IS NULL${likes} ${order}`,
    terms.join(' AND '), ...short.flatMap((t) => [`%${t}%`, `%${t}%`]), limit).map(rowToFood);
};

export const byBarcode = (code: string): Food | null => {
  const r = one<Row>(`SELECT * FROM foods WHERE barcode = ? AND deleted_at IS NULL ORDER BY (source = 'own') DESC LIMIT 1`, code);
  return r ? getFood(String(r.id)) : null;
};

/** Map an Open Food Facts product (v2 API `product`) to a food row, per 100 g. */
export const fromOff = (barcode: string, p: Row): FoodIn | null => {
  const n = (p.nutriments ?? {}) as Record<string, number>;
  let kcal = Number(n['energy-kcal_100g']);
  if (!Number.isFinite(kcal) && Number.isFinite(Number(n.energy_100g))) kcal = Number(n.energy_100g) / 4.184;
  const name = String(p.product_name_fr || p.product_name || p.generic_name || '').trim();
  if (!name || !Number.isFinite(kcal)) return null;
  const serving = Number(p.serving_quantity);
  return {
    source: 'off', source_ref: barcode, barcode, name, brand: String(p.brands ?? '').split(',')[0]?.trim() || null, kcal,
    protein: Number(n.proteins_100g ?? 0), carbs: Number(n.carbohydrates_100g ?? 0), fat: Number(n.fat_100g ?? 0),
    sat_fat: n['saturated-fat_100g'] ?? null, fiber: n.fiber_100g ?? null, sugar: n.sugars_100g ?? null,
    sodium: n.sodium_100g !== undefined ? Number(n.sodium_100g) * 1000 : null,
    servings: serving > 0 && serving < 5000 ? [{ label: String(p.serving_size || 'serving').slice(0, 60), grams: serving }] : [],
  };
};

const NEG_DAYS = 7;
/** Barcode lookup: local → cache → OFF (via `fetcher`, injected so tests and rate-limits stay outside). */
export const lookupBarcode = async (code: string, fetcher?: (code: string) => Promise<Row | null>) => {
  if (!/^\d{6,14}$/.test(code)) bad('barcode must be 6-14 digits');
  const local = byBarcode(code);
  if (local) return { food: local, from: 'local' as const };
  const c = one<{ found: number; at: string }>('SELECT found, at FROM off_cache WHERE barcode = ?', code);
  if (c && !c.found && Date.now() - Date.parse(c.at) < NEG_DAYS * 86400000) return { food: null, from: 'cache' as const };
  if (!fetcher) return { food: null, from: 'none' as const };
  const p = await fetcher(code);
  const mapped = p ? fromOff(code, p) : null;
  const food = mapped ? addFood(mapped) : null;
  run(`INSERT INTO off_cache (barcode, found, food_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (barcode) DO UPDATE SET found = excluded.found, food_id = excluded.food_id, at = excluded.at`,
    code, food ? 1 : 0, food?.id ?? null, now());
  return { food, from: 'off' as const };
};

/**
 * Generic food CSV import (Ciqual/USDA are pre-converted to this shape by scripts):
 * name, brand, kcal, protein, carbs, fat, sat_fat, fiber, sugar, sodium, barcode, source_ref, state.
 * Idempotent by (source, source_ref). Rows without kcal are skipped and counted.
 */
export const importFoodsCsv = (csv: string, source: (typeof SOURCES)[number], dryRun = false) => {
  const rows = parseCsv(csv);
  if (!rows.length || !('name' in rows[0]) || !('kcal' in rows[0])) bad('CSV needs at least name and kcal columns');
  const num = (v: unknown) => { const s = String(v ?? '').replace(',', '.').replace(/^[<~]\s*/, '').trim(); if (s === '' || s === '-' || /^traces?$/i.test(s)) return undefined; const n = Number(s); return Number.isFinite(n) ? n : undefined; };
  let added = 0, skipped = 0, flagged = 0; const errors: string[] = [];
  rows.forEach((r, i) => {
    const kcal = num(r.kcal);
    if (!String(r.name ?? '').trim() || kcal === undefined) { skipped++; return; }
    const ref = String(r.source_ref || '') || sha(`${r.name}|${r.brand ?? ''}|${kcal}`).slice(0, 20);
    if (one('SELECT 1 FROM foods WHERE source = ? AND source_ref = ?', source, ref)) { skipped++; return; }
    const f: FoodIn = { source, source_ref: ref, name: String(r.name), brand: String(r.brand ?? '') || null, kcal,
      protein: num(r.protein) ?? 0, carbs: num(r.carbs) ?? 0, fat: num(r.fat) ?? 0, sat_fat: num(r.sat_fat) ?? null,
      fiber: num(r.fiber) ?? null, sugar: num(r.sugar) ?? null, sodium: num(r.sodium) ?? null,
      barcode: /^\d{6,14}$/.test(String(r.barcode ?? '')) ? String(r.barcode) : null, state: String(r.state ?? '') || null };
    if (sanity({ kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber }).length) flagged++;
    if (dryRun) { added++; return; }
    try { addFood(f); added++; } catch (e) { errors.push(`row ${i + 2}: ${(e as Error).message}`); }
  });
  return { added, skipped, flagged, errors, dryRun };
};

// ---------- recipes ----------
export const addRecipe = (r: { id?: string; name: string; items: { food: string; grams: number }[]; cooked_g?: number; portions?: number }) => {
  const name = String(r.name ?? '').trim();
  if (!name) bad('recipe name is needed');
  if (!Array.isArray(r.items) || !r.items.length) bad('a recipe needs at least one ingredient');
  const items = r.items.map((it) => {
    if (!it || typeof it !== 'object' || typeof it.food !== 'string') bad('each ingredient needs a food and grams');
    if (!(typeof it.grams === 'number' && it.grams > 0)) bad('ingredient grams must be > 0');
    return { food_id: resolveFood(it.food).id, grams: it.grams };
  });
  const raw = items.reduce((a, b) => a + b.grams, 0);
  if (r.cooked_g !== undefined && !(r.cooked_g > 0)) bad('cooked weight must be > 0');
  const id = idOr(r.id);
  if (insert('recipes', { id, name, raw_g: raw, cooked_g: r.cooked_g ?? null, portions: r.portions && r.portions > 0 ? r.portions : 1 })) {
    for (const it of items) run('INSERT INTO recipe_items (recipe_id, food_id, grams) VALUES (?, ?, ?)', id, it.food_id, it.grams);
  }
  return getRecipe(id);
};

export const getRecipe = (ref: string) => {
  const r = need(one<Row>('SELECT * FROM recipes WHERE (id = ? OR lower(name) = lower(?)) AND deleted_at IS NULL', ref, ref), 'recipe');
  const items = all<Row>('SELECT ri.food_id, ri.grams, f.name, f.kcal, f.protein, f.carbs, f.fat FROM recipe_items ri JOIN foods f ON f.id = ri.food_id WHERE ri.recipe_id = ?', r.id);
  const tot = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const it of items) for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += (Number(it[k]) * Number(it.grams)) / 100;
  const weight = Number(r.cooked_g ?? r.raw_g);
  const per100 = Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round((v / weight) * 100, 2)])) as typeof tot;
  return { ...r, items, total: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round(v, 1)])) as typeof tot, per100, weight_g: weight,
    per_portion: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, round(v / Number(r.portions), 1)])) as typeof tot };
};
export const listRecipes = () => all<Row>('SELECT id, name, raw_g, cooked_g, portions FROM recipes WHERE deleted_at IS NULL ORDER BY name');

export const resolveFood = (ref: string): Food => {
  const r = one<Row>(`SELECT id FROM foods WHERE (id = ? OR barcode = ? OR lower(name) = lower(?)) AND deleted_at IS NULL ORDER BY (source = 'own') DESC, uses DESC LIMIT 1`, ref, ref, ref);
  if (r) return getFood(String(r.id));
  const hit = searchFoods(ref, 1)[0];
  return need(hit, `food "${ref}"`);
};

// ---------- diary ----------
export type LogIn = {
  id?: string; day?: string; at?: string; slot?: string; food?: string; recipe?: string; grams?: number; serving?: string; qty?: number;
  portions?: number; name?: string; kcal?: number; protein?: number; carbs?: number; fat?: number; note?: string; estimate?: boolean;
};
// ---------- meal slots: one rule, mirrored in app/web/src/features/food/lib.ts (slotAt) ----------
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/**
 * Meal slot for a minute of the local day (0-1439).
 * 04-12 breakfast, 12-16 lunch, 16-18 snacks, 18-22 dinner, else snacks.
 */
export const slotAt = (minute: number): string =>
  minute >= 240 && minute < 720 ? 'breakfast' : minute >= 720 && minute < 960 ? 'lunch' : minute >= 960 && minute < 1080 ? 'snacks'
    : minute >= 1080 && minute < 1320 ? 'dinner' : 'snacks';
export const slotFor = (at: Date) => slotAt(mins(hhmm(at)));

/** Log by food+grams, food+serving×qty, recipe+grams/portions, or quick kcal/macros. Same id twice = one row. */
export const logFood = (e: LogIn) => {
  const atD = e.at ? new Date(e.at) : new Date();
  if (Number.isNaN(atD.getTime())) bad('at must be an ISO time');
  const day = e.day ?? lifeDay(atD);
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  const slot = (e.slot ?? slotFor(atD)).toLowerCase();
  if (!SLOTS.includes(slot as never)) bad(`slot must be one of ${SLOTS.join(', ')}`);
  let row: { name: string; grams: number | null; kcal: number; protein: number; carbs: number; fat: number; food_id: string | null; recipe_id: string | null; estimate: boolean };
  if (e.food) {
    const f = resolveFood(e.food);
    let g = e.grams;
    if (g === undefined && e.serving) g = need(f.servings?.find((s) => s.label.toLowerCase() === e.serving!.toLowerCase()), `serving "${e.serving}"`).grams * (e.qty ?? 1);
    if (g === undefined && f.servings?.length && e.qty) g = f.servings[0].grams * e.qty;
    if (!(g! > 0 && g! < 5000)) bad('grams must be 0-5000');
    const m = g! / 100;
    row = { name: f.brand ? `${f.name} (${f.brand})` : f.name, grams: g!, kcal: f.kcal * m, protein: f.protein * m, carbs: f.carbs * m, fat: f.fat * m,
      food_id: f.id, recipe_id: null, estimate: !!e.estimate || f.source === 'estimated' };
    run('UPDATE foods SET uses = uses + 1 WHERE id = ?', f.id);
  } else if (e.recipe) {
    const r = getRecipe(e.recipe);
    const g = e.grams ?? (e.portions ? (r.weight_g / Number(r.portions)) * e.portions : undefined);
    if (!(g! > 0)) bad('give grams or portions for a recipe');
    const m = g! / 100;
    row = { name: String(r.name), grams: round(g!, 1), kcal: r.per100.kcal * m, protein: r.per100.protein * m, carbs: r.per100.carbs * m, fat: r.per100.fat * m,
      food_id: null, recipe_id: String(r.id), estimate: !!e.estimate };
  } else {
    if (!(Number(e.kcal) >= 0)) bad('give a food, a recipe, or kcal');
    row = { name: String(e.name ?? 'Quick add').slice(0, 200), grams: e.grams ?? null, kcal: Number(e.kcal), protein: Number(e.protein ?? 0),
      carbs: Number(e.carbs ?? 0), fat: Number(e.fat ?? 0), food_id: null, recipe_id: null, estimate: e.estimate ?? true };
  }
  if (row.kcal > 10000) bad('that is over 10,000 kcal in one entry');
  const id = idOr(e.id);
  insert('food_log', { id, day, slot, at: atD.toISOString(), ...row, kcal: round(row.kcal, 1), protein: round(row.protein, 1), carbs: round(row.carbs, 1),
    fat: round(row.fat, 1), note: String(e.note ?? '').slice(0, 500) });
  return one<Row>('SELECT * FROM food_log WHERE id = ?', id)!;
};

export const updateLog = (id: string, f: { grams?: number; slot?: string; day?: string; note?: string }) => {
  const cur = need(one<Row>('SELECT * FROM food_log WHERE id = ? AND deleted_at IS NULL', id), 'entry');
  if (f.slot && !SLOTS.includes(f.slot as never)) bad('bad slot');
  if (f.day && !isDate(f.day)) bad('bad day');
  const fields: Row = { slot: f.slot, day: f.day, note: f.note };
  if (f.grams !== undefined && cur.grams) {
    if (!(f.grams > 0)) bad('grams must be > 0');
    const m = f.grams / Number(cur.grams);
    Object.assign(fields, { grams: f.grams, kcal: round(Number(cur.kcal) * m, 1), protein: round(Number(cur.protein) * m, 1), carbs: round(Number(cur.carbs) * m, 1), fat: round(Number(cur.fat) * m, 1) });
  }
  patch('food_log', id, fields);
  return one<Row>('SELECT * FROM food_log WHERE id = ?', id)!;
};
export const deleteLog = (id: string) => softDelete('food_log', id);

export const addWater = (ml = 250, day = lifeToday(), id?: string) => {
  if (!(ml > -2000 && ml <= 3000 && ml !== 0)) bad('ml must be -2000..3000 and not 0');
  insert('water_log', { id: idOr(id), day, ml });
  return waterOn(day);
};
const waterOn = (day: string) => Number(one<{ s: number }>('SELECT COALESCE(SUM(ml), 0) AS s FROM water_log WHERE day = ? AND deleted_at IS NULL', day)!.s);

export const DAY_STATUSES = ['complete', 'partial', 'blank'] as const;
/**
 * Mark a food day: complete (everything logged), partial (some meals missing), blank. null clears it.
 * Only complete days feed the adaptive TDEE.
 */
export const setDayStatus = (day: string, status: (typeof DAY_STATUSES)[number] | null) => {
  if (!isDate(day)) bad('day must be YYYY-MM-DD');
  if (status === null) { run('DELETE FROM day_status WHERE day = ?', day); return { day, status: null }; }
  if (!DAY_STATUSES.includes(status)) bad(`status must be one of ${DAY_STATUSES.join(', ')}`);
  run('INSERT INTO day_status (day, status) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET status = excluded.status', day, status);
  return { day, status };
};
export const dayStatus = (day: string) => one<{ status: string }>('SELECT status FROM day_status WHERE day = ?', day)?.status ?? null;

// ---------- targets ----------
export const setTargets = (t: { from_day?: string; kcal: number; protein: number; carbs?: number; fat?: number; method?: string }) => {
  const from = t.from_day ?? lifeToday();
  if (!isDate(from)) bad('from_day must be YYYY-MM-DD');
  const bmr = estimateFromProfile(from).bmr ?? 0;
  const floor = Math.max(KCAL_FLOOR, bmr);
  const kcal = Math.round(Math.max(Number(t.kcal), floor));
  if (!(t.protein >= 0)) bad('protein must be >= 0');
  const fat = t.fat ?? Math.round((kcal * 0.28) / 9);
  const carbs = t.carbs ?? Math.max(0, Math.round((kcal - 4 * t.protein - 9 * fat) / 4));
  run(`INSERT INTO nutrition_targets (from_day, kcal, protein, carbs, fat, method) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (from_day) DO UPDATE SET kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat, method = excluded.method`,
    from, kcal, t.protein, carbs, fat, t.method ?? 'manual');
  return { ...targetFor(from)!, floored: kcal > Number(t.kcal) };
};
export const targetFor = (day: string) =>
  one<{ from_day: string; kcal: number; protein: number; carbs: number; fat: number; method: string }>(
    'SELECT * FROM nutrition_targets WHERE from_day <= ? ORDER BY from_day DESC LIMIT 1', day) ?? null;

// ---------- day view ----------
const sum = (rows: Row[]) => {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += Number(r[k] ?? 0);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v, 1)])) as typeof t;
};
export const dayEntries = (day: string) => all<Row>('SELECT * FROM food_log WHERE day = ? AND deleted_at IS NULL ORDER BY at', day);

export const foodDay = (day = lifeToday()) => {
  const entries = dayEntries(day);
  // The four everyday slots always exist (empty ones too). Other slots appear once used.
  const slots: Record<string, { entries: Row[]; total: ReturnType<typeof sum> }> = {};
  const fixed = ['breakfast', 'lunch', 'dinner', 'snacks'];
  for (const s of fixed) slots[s] = { entries: [], total: sum([]) };
  for (const e of entries) (slots[String(e.slot)] ??= { entries: [], total: sum([]) }).entries.push(e);
  for (const s of Object.values(slots)) s.total = sum(s.entries);
  const total = sum(entries);
  const target = targetFor(day);
  return {
    day, total, slots, water_ml: waterOn(day), status: dayStatus(day), target,
    left: target ? { kcal: round(target.kcal - total.kcal, 0), protein: round(target.protein - total.protein, 0) } : null,
    estimates: entries.filter((e) => e.estimate).length,
    note: 'Estimates, not medical advice.',
  };
};

export const copyMeal = (fromDay: string, toDay: string, slot?: string, toSlot?: string) => {
  if (!isDate(fromDay) || !isDate(toDay)) bad('from_day and to_day must be YYYY-MM-DD');
  if ((slot != null && typeof slot !== 'string') || (toSlot != null && typeof toSlot !== 'string')) bad('slot must be text');
  const src = dayEntries(fromDay).filter((e) => !slot || e.slot === slot);
  let n = 0;
  for (const e of src) {
    // deterministic id: copying the same day twice does not double it
    const id = sha(`copy:${e.id}:${toDay}:${toSlot ?? e.slot}`).slice(0, 36);
    if (insert('food_log', { id, day: toDay, slot: toSlot ?? e.slot, at: now(), food_id: e.food_id, recipe_id: e.recipe_id, name: e.name, grams: e.grams,
      kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, note: e.note, estimate: e.estimate })) n++;
  }
  return n;
};

export const saveMeal = (name: string, day: string, slot: string) => {
  const items = dayEntries(day).filter((e) => e.slot === slot).map((e) => ({ food: e.food_id, recipe: e.recipe_id, grams: e.grams, name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }));
  if (!items.length) bad('nothing logged in that meal');
  const id = uuid();
  insert('meal_presets', { id, name: String(name).trim().slice(0, 100), items });
  return { id, name, items: items.length };
};
export const listMeals = () => all<Row>('SELECT id, name, items FROM meal_presets WHERE deleted_at IS NULL ORDER BY name').map((r) => ({ ...r, items: j<Row[]>(r.items, []) }));
export const logMeal = (ref: string, day = lifeToday(), slot?: string) => {
  const m = need(one<Row>('SELECT * FROM meal_presets WHERE (id = ? OR lower(name) = lower(?)) AND deleted_at IS NULL', ref, ref), 'meal');
  return j<Row[]>(m.items, []).map((it) => it.food
    ? logFood({ day, slot, food: String(it.food), grams: Number(it.grams) })
    : it.recipe ? logFood({ day, slot, recipe: String(it.recipe), grams: Number(it.grams) })
      : logFood({ day, slot, name: String(it.name), kcal: Number(it.kcal), protein: Number(it.protein), carbs: Number(it.carbs), fat: Number(it.fat) }));
};

// ---------- reports ----------
export const range = (from: string, to: string) => {
  const rows = all<Row>(`SELECT l.day, SUM(l.kcal) AS kcal, SUM(l.protein) AS protein, SUM(l.carbs) AS carbs, SUM(l.fat) AS fat, s.status
    FROM food_log l LEFT JOIN day_status s ON s.day = l.day WHERE l.deleted_at IS NULL AND l.day BETWEEN ? AND ? GROUP BY l.day ORDER BY l.day`, from, to);
  const logged = rows.length;
  return { from, to, days: rows.map((r) => ({ ...r, kcal: round(Number(r.kcal), 0) })), logged_days: logged,
    avg_kcal_logged_days: logged ? round(rows.reduce((a, r) => a + Number(r.kcal), 0) / logged, 0) : null };
};

export const topSources = (from: string, to: string, nutrient: 'kcal' | 'protein' | 'carbs' | 'fat' = 'protein', limit = 10) =>
  all<Row>(`SELECT name, ROUND(SUM(${nutrient}), 1) AS total, COUNT(*) AS times FROM food_log WHERE deleted_at IS NULL AND day BETWEEN ? AND ?
    GROUP BY name ORDER BY total DESC LIMIT ?`, from, to, limit);

// ---------- adaptive TDEE ----------
/**
 * Weekly check-in. Window = 21 days ending yesterday. Uses only days marked complete.
 * Unmarked, partial and blank days never count: an under-logged day would make the estimate too low.
 * Needs >= 10 counted days and >= 4 weigh-ins, else returns the reason and keeps the current target.
 */
export const adaptiveTdee = (today = lifeToday()) => {
  const to = addDays(today, -1), from = addDays(today, -21);
  const days = range(from, to).days.filter((d) => d.status === 'complete');
  const weighIns = dailyWeights(from, to).length;
  const base = { from, to, counted_days: days.length, weigh_ins: weighIns };
  if (days.length < 10 || weighIns < 4) {
    return { ...base, tdee: null, reason: days.length < 10 ? `need 10 days marked complete in the last 21 (have ${days.length})` : 'need 4 weigh-ins in the last 21 days' };
  }
  const tr = trend(to);
  const t0 = tr.find((x) => x.day >= from)?.trend, t1 = tr.at(-1)?.trend;
  if (t0 === undefined || t1 === undefined) return { ...base, tdee: null, reason: 'no trend weight yet' };
  const span = Math.max(7, tr.filter((x) => x.day >= from).length - 1);
  const avgIntake = days.reduce((a, d) => a + Number(d.kcal), 0) / days.length;
  const tdee = Math.round(avgIntake - ((t1 - t0) * 7700) / span);
  return { ...base, tdee, avg_intake: Math.round(avgIntake), trend_change_kg: round(t1 - t0, 2), weekly_rate_kg: round(((t1 - t0) / span) * 7, 2),
    note: 'Estimate from your own intake and trend weight.' };
};

/** Suggest a target from adaptive TDEE (or Mifflin) and a goal rate (kg/week, negative = lose). Never below the floor. */
export const suggestTarget = (goalKgPerWeek = 0, proteinPerKg = 1.8, today = lifeToday()) => {
  if (goalKgPerWeek < -1 || goalKgPerWeek > 0.5) bad('goal rate must be between -1 and 0.5 kg/week');
  const a = adaptiveTdee(today);
  const est = estimateFromProfile(today);
  const tdee = a.tdee ?? est.tdee;
  if (!tdee) return { kcal: null, method: null, missing: est.missing, reason: 'reason' in a ? a.reason : undefined };
  const floor = Math.max(KCAL_FLOOR, est.bmr ?? 0);
  const kcal = Math.max(floor, Math.round(tdee + (goalKgPerWeek * 7700) / 7));
  const w = (est as { weight_kg?: number }).weight_kg ?? null;
  return { kcal, protein: w ? Math.round(w * proteinPerKg) : null, method: a.tdee ? 'adaptive' : 'mifflin', tdee, floored: kcal === floor };
};

// ---------- MyFitnessPal import (meal totals) ----------
/** MFP "Nutrition Summary" CSV: Date, Meal, Calories, Fat (g), Carbohydrates (g), Protein (g), ... Idempotent. */
export const importMfp = (csv: string, dryRun = false) => {
  const rows = parseCsv(csv);
  if (!rows.length || !('Date' in rows[0]) || !('Calories' in rows[0])) bad('not a MyFitnessPal nutrition summary CSV');
  const MAP: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snacks: 'snacks' };
  let added = 0, skipped = 0;
  for (const r of rows) {
    const day = String(r.Date).slice(0, 10);
    const kcal = Number(r.Calories);
    if (!isDate(day) || !Number.isFinite(kcal)) { skipped++; continue; }
    const meal = String(r.Meal ?? 'Snacks').toLowerCase();
    const id = sha(`mfp:${day}:${meal}:${kcal}`).slice(0, 36);
    if (one('SELECT 1 FROM food_log WHERE id = ?', id)) { skipped++; continue; }
    if (!dryRun) {
      insert('food_log', { id, day, slot: MAP[meal] ?? 'snacks', at: zonedIso(day, '12:00'), name: `MyFitnessPal ${r.Meal ?? 'meal'}`, grams: null, kcal,
        protein: Number(r['Protein (g)'] ?? 0), carbs: Number(r['Carbohydrates (g)'] ?? 0), fat: Number(r['Fat (g)'] ?? 0), note: 'imported', estimate: false });
      run(`INSERT INTO day_status (day, status) VALUES (?, 'complete') ON CONFLICT (day) DO NOTHING`, day);
    }
    added++;
  }
  return { added, skipped, dryRun };
};
