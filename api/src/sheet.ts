// Google Sheets v4: Mode cell and Money totals. All writes RAW (no formula injection).
import { cfg } from './config.ts';
import { kvGet, kvSet } from './db.ts';
import { fail } from './errors.ts';
import { googleFetch } from './google.ts';

export type Mode = 'Normal' | 'Zero' | 'Family';
export const MODES: Mode[] = ['Normal', 'Zero', 'Family'];

const RULES = 'Rules+Money';

/** 'Rules+Money' → quoted tab name for A1 ranges. */
export const tab = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** Case-insensitive mode name → canonical, or null. */
export const canonicalMode = (s: unknown): Mode | null =>
  MODES.find((m) => m.toLowerCase() === String(s ?? '').trim().toLowerCase()) ?? null;

const base = () => {
  const id = cfg('SHEET_ID');
  if (!id) fail('bad_request', 'SHEET_ID not set: run mosaic-connect sheet');
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`;
};

export const sheetValues = async (range: string): Promise<string[][]> => {
  const j = await googleFetch(`${base()}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  return ((j?.values ?? []) as unknown[][]).map((r) => r.map((c) => (c == null ? '' : String(c))));
};

const writeRaw = (range: string, values: (string | number)[][]) =>
  googleFetch(`${base()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
  });

export const sheetWrite = async (range: string, values: string[][]): Promise<void> => { await writeRaw(range, values); };

/** Append rows (RAW). Returns the 1-based sheet row of the first appended row, or null. */
const appendRaw = async (range: string, values: string[][]): Promise<number | null> => {
  const j = await googleFetch(
    `${base()}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ range, majorDimension: 'ROWS', values }) },
  );
  const m = String(j?.updates?.updatedRange ?? '').match(/![A-Z]+(\d+)/);
  return m ? Number(m[1]) : null;
};

export const sheetTabs = async (): Promise<{ title: string; sheetId: number }[]> => {
  const j = await googleFetch(`${base()}?fields=${encodeURIComponent('sheets.properties(title,sheetId)')}`);
  return ((j?.sheets ?? []) as { properties: { title: string; sheetId: number } }[]).map((s) => ({
    title: s.properties.title, sheetId: s.properties.sheetId,
  }));
};

// ---------- Mode ----------
const rulesRows = () => sheetValues(`${tab(RULES)}!A1:C200`);
const isModeKey = (a: string | undefined) => (a ?? '').trim().toLowerCase() === 'mode';

/** Pure: find the mode in Rules+Money rows. */
export const modeFromRows = (rows: string[][]): Mode | null => canonicalMode(rows.find((r) => isModeKey(r[0]))?.[1]);

const cachedMode = (): Mode => canonicalMode(kvGet('mode')) ?? 'Normal';

export const getMode = async (): Promise<{ mode: Mode; source: 'sheet' | 'cache' }> => {
  try {
    const mode = modeFromRows(await rulesRows());
    if (mode) { kvSet('mode', mode); return { mode, source: 'sheet' }; }
  } catch { /* fall through to cache */ }
  return { mode: cachedMode(), source: 'cache' };
};

export const setMode = async (mode: Mode): Promise<{ mode: Mode }> => {
  const m = canonicalMode(mode);
  if (!m) return fail('bad_request', `Mode must be one of ${MODES.join(', ')}.`);
  const rows = await rulesRows();
  const i = rows.findIndex((r) => isModeKey(r[0]));
  if (i >= 0) await writeRaw(`${tab(RULES)}!B${i + 1}`, [[m]]);
  else await appendRaw(`${tab(RULES)}!A:B`, [['mode', m]]);
  kvSet('mode', m);
  return { mode: m };
};

// ---------- Money ----------
export const moneyRead = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const r of await rulesRows()) {
    const k = (r[0] ?? '').trim();
    if (k && !isModeKey(k)) out[k] = r[1] ?? '';
  }
  return out;
};

export const moneyUpdateTotals = async (values: Record<string, number>): Promise<{ updated: string[] }> => {
  if (!values || typeof values !== 'object' || !Object.keys(values).length) return fail('bad_request', 'No totals given.');
  const rows = await rulesRows();
  const data: { range: string; values: number[][] }[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (isModeKey(k)) return fail('bad_request', 'Use set_mode to change mode, not money totals.');
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail('bad_request', `Total "${k}" must be a finite number.`);
    const i = rows.findIndex((r) => (r[0] ?? '').trim() === k.trim());
    if (i < 0) return fail('bad_request', `Unknown money key "${k}": only existing Rules+Money rows can be updated.`);
    data.push({ range: `${tab(RULES)}!B${i + 1}`, values: [[v]] });
  }
  await googleFetch(`${base()}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  return { updated: Object.keys(values).map((k) => k.trim()) };
};

// ---------- Rows ----------
/** Pure: header row + rows → objects (empty rows dropped). */
export const rowsToObjects = (rows: string[][]): Record<string, string>[] => {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''] as const).filter(([k]) => k)));
};

/** A value a spreadsheet could read as a formula. Plain numbers and phone numbers (+1 555-0100) are fine. */
export const looksLikeFormula = (v: string) => /^\s*[=+\-@]/.test(v) && !/^\s*[+-]?[\d\s().-]*\d[\d\s().-]*$/.test(v);
