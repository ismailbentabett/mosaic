// Food logic shared by the tabs: slots, quick estimates, recent foods on this device, undo after a log.
import { useCallback, useState } from 'react';
import * as f from '../../fmt';
import { act } from '../../hooks';
import { feel } from '../../sound';
import { emit, toastUndo } from '../../store';
import { localMinutes } from '../../time';
import { EXTRA_SLOTS, SLOTS, v2, type FoodDay, type FoodEntry, type LogIn, type Slot, type Tdee } from '../../v2';
import { parseNum, readLocal, writeLocal } from '../money/undo';

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
  late: 'Night snacks',
};
export const EMPTY_SLOT = { entries: [] as FoodEntry[], total: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };

// ---- Meal slots: one rule, the same as the server (api food/store.ts slotAt) ----
/**
 * Meal slot for a minute of the local day (0-1439).
 * 04:00-12:00 breakfast, 12:00-16:00 lunch, 16:00-18:00 snacks, 18:00-22:00 dinner, else snacks.
 */
export function slotAt(minute: number): Slot {
  if (minute >= 240 && minute < 720) return 'breakfast';
  if (minute >= 720 && minute < 960) return 'lunch';
  if (minute >= 960 && minute < 1080) return 'snacks';
  if (minute >= 1080 && minute < 1320) return 'dinner';
  return 'snacks';
}

/** Meal slot for "now". The single web source; QuickAdd and the food tabs import it. */
export function slotNow(now: number | Date = Date.now()): Slot {
  return slotAt(localMinutes(now));
}

/** "N kcal left" while under the target; nothing at or over it (no "over" verdicts). */
export const kcalLeftLine = (left: number | null | undefined) => (left != null && left > 0 ? `${f.kcal(left)} left` : null);

/** Maintenance line from /food/tdee: the adaptive estimate, else why there is none yet. */
export function maintenanceLine(t: Tdee | null | undefined): string | null {
  if (!t) return null;
  const a = t.adaptive;
  if (a.tdee) {
    const s = t.suggestion.kcal;
    return `Your maintenance looks like ~${f.kcal(a.tdee)} (last 21 days).${s && s !== a.tdee ? ` Suggested target ~${f.kcal(s)}.` : ''}`;
  }
  return a.reason ? `Maintenance estimate: ${a.reason}.` : null;
}

/** Slots to offer: the everyday ones, then night snacks. */
export function slotChoices(): Slot[] {
  return [...SLOTS, ...EXTRA_SLOTS];
}

/** "kebab 600", "600 kebab", "tagine 600 kcal" → an estimate. Small numbers ("2 eggs") are portions, not calories. */
export function parseEstimate(text: string): { name: string; kcal: number; explicit: boolean } | null {
  const t = text.trim();
  const k = t.match(/(\d+(?:[.,]\d+)?)\s*k?cal(?![a-z])/i);
  if (k) {
    const kcal = parseNum(k[1]);
    return kcal > 0 ? { name: t.replace(k[0], '').trim() || 'Food', kcal, explicit: true } : null;
  }
  const m = t.match(/^(\D.*?)\s+(\d+(?:[.,]\d+)?)$/) ?? t.match(/^(\d+(?:[.,]\d+)?)\s+(\D.*)$/);
  if (!m) return null;
  const [name, n] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const kcal = parseNum(n);
  return kcal >= 30 && kcal <= 5000 ? { name: name.trim(), kcal, explicit: false } : null;
}

const FOODS_KEY = 'mosaic.track.recentFoods';
export type RecentFood = { name: string; kcal: number; protein: number; carbs: number; fat: number; food_id: string | null; grams: number | null; estimate: boolean };
export const toRecent = (e: FoodEntry): RecentFood => ({
  name: e.name,
  kcal: e.kcal,
  protein: e.protein,
  carbs: e.carbs,
  fat: e.fat,
  food_id: e.food_id,
  grams: e.grams,
  estimate: !!e.estimate,
});
export function rememberFood(e: FoodEntry) {
  const list = readLocal<RecentFood[]>(FOODS_KEY, []);
  const k = e.name.trim().toLowerCase();
  writeLocal(FOODS_KEY, [toRecent(e), ...list.filter((x) => x.name.trim().toLowerCase() !== k)].slice(0, 20));
}
export const readRecent = () => readLocal<RecentFood[]>(FOODS_KEY, []);

/** Recent foods on this device plus today's entries, one per name. */
export function recentList(d: FoodDay | null | undefined, max = 20): RecentFood[] {
  const todays = Object.values(d?.slots ?? {}).flatMap((s) => s?.entries ?? []).map(toRecent);
  const out: RecentFood[] = [];
  const seen = new Set<string>();
  for (const r of [...readRecent(), ...todays]) {
    const k = r.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Same food again: by catalogue id and grams when known, else as an entry with the saved macros. */
export const repeatLog = (r: RecentFood, slot: Slot): LogIn =>
  r.food_id && r.grams
    ? { slot, food: r.food_id, grams: r.grams }
    : { slot, name: r.name, kcal: Math.round(r.kcal), protein: r.protein, carbs: r.carbs, fat: r.fat, estimate: r.estimate };

/** After a log: sound, remember it on this device, and offer Undo. `tick` changes so recent lists re-read. */
export function useLogged() {
  const [tick, setTick] = useState(0);
  const logged = useCallback((e: FoodEntry, label: string) => {
    feel('capture');
    rememberFood(e);
    setTick((n) => n + 1);
    toastUndo(`${label} · ${f.kcal(e.kcal)}`, () => {
      void act(v2.deleteLog(e.id)).then(() => emit('food'));
    });
  }, []);
  return { logged, tick };
}

/** Log a recent food again into `slot`. */
export async function logAgain(r: RecentFood, slot: Slot, logged: (e: FoodEntry, label: string) => void) {
  const e = await act(v2.logFood(repeatLog(r, slot)));
  emit('food');
  if (e) logged(e, `${r.name} · ${SLOT_LABEL[slot]}`);
}
