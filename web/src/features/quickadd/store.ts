import { v2, type Account, type Habit, type V2Project, type Workout } from "../../v2";
import type { When } from "./labels";
import { addDays, parseTask, patternKey, type QuickType } from "./parseQuick";

/* ------------------------------------------------------------------ */
/* Small persisted prefs                                               */
/* ------------------------------------------------------------------ */

export const RECENT_KEY = "mosaic.quickRecent";
export const OVR_KEY = "mosaic.quickOverrides";
export const ACC_KEY = "mosaic.quickAccount";
export const KEEP_KEY = "mosaic.quickKeepOpen";
export const FOODS_KEY = "mosaic.quickFoods";

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: nothing to remember */
  }
}

export type Recent = { type: QuickType; label: string; at: number };

export function pushRecent(r: Recent) {
  const list = readJson<Recent[]>(RECENT_KEY, []).filter(
    (x) => !(x.type === r.type && x.label === r.label)
  );
  writeJson(RECENT_KEY, [r, ...list].slice(0, 6));
}
export function rememberOverride(text: string, type: QuickType) {
  const key = patternKey(text);
  if (!key) return;
  const o = readJson<Record<string, QuickType>>(OVR_KEY, {});
  o[key] = type;
  // Keep the map small: the newest 80 shapes.
  const keys = Object.keys(o);
  if (keys.length > 80) delete o[keys[0]];
  writeJson(OVR_KEY, o);
}
export function rememberFood(name: string) {
  const n = name.trim().toLowerCase();
  if (!n) return;
  const list = readJson<string[]>(FOODS_KEY, []).filter((x) => x !== n);
  writeJson(FOODS_KEY, [n, ...list].slice(0, 60));
}

/* ------------------------------------------------------------------ */
/* Context: projects, habits, accounts, the running workout            */
/* ------------------------------------------------------------------ */

export type Ctx = {
  projects: V2Project[];
  habits: Habit[];
  accounts: Account[];
  workout: Workout | null;
};
export const EMPTY_CTX: Ctx = {
  projects: [],
  habits: [],
  accounts: [],
  workout: null,
};
export let ctxCache: Ctx | null = null;

export async function loadCtx(): Promise<Ctx> {
  const [p, h, a, w] = await Promise.allSettled([
    v2.projects(),
    v2.habits(),
    v2.accounts(),
    v2.active(),
  ]);
  const next: Ctx = {
    projects: p.status === "fulfilled" ? p.value : ctxCache?.projects ?? [],
    habits:
      h.status === "fulfilled"
        ? h.value.filter((x) => !x.archived)
        : ctxCache?.habits ?? [],
    accounts:
      a.status === "fulfilled"
        ? a.value.filter((x) => !x.archived)
        : ctxCache?.accounts ?? [],
    workout:
      w.status === "fulfilled" ? w.value.workout : ctxCache?.workout ?? null,
  };
  ctxCache = next;
  return next;
}

export function whenDate(w: When, today: string): string | null {
  switch (w) {
    case "today":
      return today;
    case "tomorrow":
      return addDays(today, 1);
    case "weekend":
      return parseTask("x weekend", today).when;
    case "nextweek":
      return parseTask("x next week", today).when;
    default:
      return null;
  }
}

export const lastExercise = (w: Workout | null) =>
  w && w.sets.length ? w.sets[w.sets.length - 1].exercise_name : null;
export const bareNumber = (s: string) =>
  /^\d+(?:[.,]\d+)?$/.test(s.trim())
    ? Number(s.trim().replace(",", "."))
    : null;
