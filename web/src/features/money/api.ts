// Money routes the shared v2/life clients do not cover yet. Shapes mirror
// app/api/src/modules/money + thrift + food routes. Move these into v2.ts/life.ts when convenient.
import { enc, q, request } from '../../api';
import { sendOrQueue } from '../../outbox';
import { newId, type MoneyRecord, type ShoppingItem } from '../../v2';

const P = '/api/v2';
const get = <T>(path: string) => request<T>('GET', P + path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', P + path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', P + path, body);
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', P + path, body);
const del = <T>(path: string) => request<T>('DELETE', P + path);

export type RecordPatch = Partial<{ amount: number; day: string; category: string; note: string; payee: string; labels: string[]; kind: 'expense' | 'income'; rate_to_usd: number }>;

export type ByWho = {
  from: string;
  to: string;
  by_who: { who: string; usd: number; count: number }[];
  untagged_usd: number;
  untagged_count: number;
  total_usd: number;
};

export type RecipeRow = { id: string; name: string; raw_g: number | null; cooked_g: number | null; portions: number | null };
export type RecipeToShopping = {
  recipe: string;
  portions: number;
  days: number;
  factor: number;
  list: string;
  added: ShoppingItem[];
  merged: { id: string; name: string; qty: string | null }[];
  skipped: string[];
};

export type FreeToSpend =
  | {
      free?: undefined;
      estimate: boolean;
      week_from: string;
      week_to: string;
      source: string;
      budget_usd: number;
      used_usd: number;
      planned_usd: number;
      free_usd: number;
      planned: { id: string; name: string; due: string | null; usd: number }[];
      line: string;
    }
  | { free: null; reason: string; estimate: true };

/** Tags for who a personal expense was for. Free text is allowed by the server; these are the defaults. */
export const WHO_DEFAULTS = ['self', 'family', 'gift', 'other'] as const;

export const moneyApi = {
  records: (p: { from?: string; to?: string; q?: string; limit?: number; account?: string; category?: string; kind?: 'expense' | 'income' | 'transfer' } = {}) =>
    get<MoneyRecord[]>('/money/records' + q(p)),
  updateRecord: (id: string, p: RecordPatch) => patch<MoneyRecord>(`/money/records/${enc(id)}`, p),
  setRecordFor: (id: string, who: string | null) => put<unknown>(`/records/${enc(id)}/for`, { who }),
  getRecordFor: (id: string) => get<{ record_id: string; who: string | null }>(`/records/${enc(id)}/for`),
  /** Structured log from the form; queued offline like quick add. */
  logRecord: (b: { kind: 'expense' | 'income'; amount: number; currency: string; note?: string }) =>
    sendOrQueue<MoneyRecord>('POST', P + '/money/records', { id: newId(), structured: true, ...b }),
  spendByWho: (from?: string, to?: string) => get<ByWho>('/thrift/by-who' + q({ from, to })),
  recipes: () => get<RecipeRow[]>('/food/recipes'),
  recipeToShopping: (b: { recipe: string; portions: number; days: number; list: string; skip?: string[] }) =>
    post<RecipeToShopping>('/thrift/recipe-to-shopping', { skip: [], ...b }),
  freeToSpend: () => get<FreeToSpend>('/free-to-spend'),
  deleteSkipped: (id: string) => del<unknown>(`/thrift/skipped/${enc(id)}`),
  shopping: (list?: string) => get<ShoppingItem[]>('/shopping' + q({ list })),
  addShopping: (name: string, list: string, qty?: string) =>
    sendOrQueue<ShoppingItem>('POST', P + '/shopping', { id: newId(), name, list, qty: qty || undefined }),
  clearDone: (list?: string) => post<{ cleared: number }>('/shopping/clear-done' + q({ list })),
};
