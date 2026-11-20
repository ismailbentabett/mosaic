import type { MoneyRecord } from '../../v2';
import { dateAtNoon, ymd } from '../../time';

/** Row title: what was typed, unless it only repeats the category. */
export const recordTitle = (r: MoneyRecord) => {
  const said = r.note || r.payee;
  const same = !!said && !!r.category_name && said.trim().toLowerCase() === r.category_name.toLowerCase();
  return { title: (same ? r.category_name : said) || r.category_name || (r.kind === 'income' ? 'Income' : 'Expense'), same };
};

/** The quick-log text that would create this record again. */
export const recordText = (r: MoneyRecord) =>
  `${r.kind === 'income' ? '+' : ''}${r.currency === 'USD' ? '$' : r.currency === 'EUR' ? '€' : ''}${r.amount} ${recordTitle(r).title}`.trim();

/** The life day `n` days before `day` (YYYY-MM-DD, local time). */
export const daysBefore = (day: string, n: number) => ymd(dateAtNoon(day).getTime() - n * 86_400_000);

/** First day of the month of `day`. */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
