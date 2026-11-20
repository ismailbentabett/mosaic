import { toastUndo } from '../../store';
import { dateAtNoon, ymd } from '../../time';
import { v2 } from '../../v2';

export const FIVE_MIN = 5 * 60_000;
/** Evening cards (rate the day, close the day) from the end of the last block (22:20) until the 04:00 day roll. */
export const EVENING_FROM = 22 * 60 + 20;
export const NIGHT_FROM = 23 * 60;
export const DAY_START = 4 * 60;

export const addDay = (date: string, n: number) => ymd(dateAtNoon(date).getTime() + n * 86_400_000);
export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Done receipt: "Done · <title> → N this month". A plain count, with Undo. */
export async function doneReceipt(title: string, undo: () => void) {
  const m = await v2.doneMonth().catch(() => null);
  toastUndo(m ? `Done · ${title} → ${m.tasks} this month` : `Done · ${title}`, undo);
}
