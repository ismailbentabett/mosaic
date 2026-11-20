// Shared helpers for Phase 2 modules: ids, timestamps, JSON columns, soft delete, idempotent inserts.
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.ts';
import { AppError } from '../errors.ts';

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();
export const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export const checkId = (id: unknown, name = 'id'): string => {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new AppError('bad_request', `${name} must be 8-64 letters, digits or dashes`);
  return id;
};
/** Use the client's id when given (offline replay), else make one. */
export const idOr = (id?: unknown) => (id === undefined || id === null ? uuid() : checkId(id));

export const j = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string') return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

export const db = () => getDb();
// Rows from node:sqlite are loose; `any` keeps spreads ({...row, extra}) typed as rows instead of dropping columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;

export const all = <T = Row>(sql: string, ...p: unknown[]) => db().prepare(sql).all(...(p as never[])) as T[];
export const one = <T = Row>(sql: string, ...p: unknown[]) => db().prepare(sql).get(...(p as never[])) as T | undefined;
export const run = (sql: string, ...p: unknown[]) => db().prepare(sql).run(...(p as never[]));

/** Insert a row with common columns. Same id twice → existing row is kept (idempotent replay). Returns true if inserted. */
export const insert = (table: string, row: Row): boolean => {
  const t = now();
  const r: Row = { created_at: t, updated_at: t, ...row };
  const keys = Object.keys(r);
  const res = run(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
    ...keys.map((k) => norm(r[k])));
  return Number(res.changes) > 0;
};

/** Patch columns on a row (only defined keys). Bumps updated_at. */
export const patch = (table: string, id: string, fields: Row) => {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => norm(fields[k])), now(), id);
};

export const softDelete = (table: string, id: string) => run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, now(), now(), id);
export const restore = (table: string, id: string) => run(`UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ?`, now(), id);
/** Hard-delete rows soft-deleted more than `days` ago. */
export const purge = (table: string, days = 30) =>
  Number(run(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`, new Date(Date.now() - days * 86400000).toISOString()).changes);

const norm = (v: unknown) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
};

export const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new AppError('not_found', `${what} not found`);
  return v;
};

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Minimal CSV parser: quotes, escaped quotes, comma or semicolon (auto-detected from header), CRLF. */
export const parseCsv = (text: string): Row[] => {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
};

export const toCsv = (rows: Row[]) => {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n') + '\n';
};
