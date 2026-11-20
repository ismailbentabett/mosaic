// Entry for the /api/v2 mock: GET /life plus every module router. Mock only: loaded through mock.ts behind MOCK.
import type { LifeSnapshot } from '../v2';
import { closedToday, daysAway, doneCounts, firstThing, handleExtras, nextAnchor, rescueOn, screenGlance } from './extras';
import { carGlance, handleCar } from './car';
import { handleGrades } from './grades';
import { bodySummary, foodDay, gymGlance, handleHealth } from './health';
import { handleLife } from './life';
import { handleMoney, runway, summary } from './money';
import { handlePush } from './push';
import { capacity, counts, goalsV1, handleTasks, listHabits, openAsks, whatNow } from './tasks';
import { fail, ok, setMockMode, today, type Ctx, type Handler, type Res } from './util';

const HANDLERS: Handler[] = [handleTasks, handleMoney, handleHealth, handleLife, handleGrades, handleExtras, handleCar, handlePush];

function life(mode: string): LifeSnapshot {
  const d = today();
  const food = foodDay(d);
  return {
    day: d,
    mode,
    tasks: { counts: counts(), what_now: whatNow(), capacity: capacity() },
    habits: listHabits(d),
    goals: goalsV1,
    money: { week: summary('week'), runway: runway() },
    food: { total: food.total, target: food.target, water_ml: food.water_ml },
    gym: gymGlance(),
    body: bodySummary(),
    asks_open: openAsks(3).map((a) => ({ key: a.key, question: a.question })),
    note: 'Mock data. Writes stay in memory until reload.',
    next_anchor: nextAnchor(),
    days_away: daysAway(),
    rescue: rescueOn,
    closed: closedToday(),
    first_thing: firstThing(),
    done: doneCounts(d, d),
    screentime: screenGlance(),
    car: carGlance(),
  };
}

/** Route one /api/v2 request. `path` is relative to /api/v2 (e.g. "/life"). Returns null when no mock covers it. */
export function mockV2(method: string, path: string, qp: URLSearchParams, b: Record<string, unknown>, mode = 'Normal'): Res | null {
  const c: Ctx = { method, p: path, qp, b, route: `${method} ${path}` };
  setMockMode(mode);
  // Like the API: a malformed day/from/to query is a 400, never a silent fallback to today.
  for (const k of ['day', 'from', 'to']) {
    const v = qp.get(k);
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`)))) return fail(400, 'bad_request', `${k} must be YYYY-MM-DD`);
  }
  if (c.route === 'GET /life') return ok(life(mode));
  for (const h of HANDLERS) {
    const r = h(c);
    if (r) return r;
  }
  return null;
}
