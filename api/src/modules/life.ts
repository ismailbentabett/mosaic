// life_snapshot: one call that tells Claude (and the Home screen) the state of the owner's personal life today.
// Each part fails alone: a broken module shows { error } and never blocks the rest.
import { lifeToday } from '../time.ts';
import * as tasks from './tasks/store.ts';
import * as money from './money/store.ts';
import * as food from './food/store.ts';
import * as gym from './gym/store.ts';
import * as body from './body/store.ts';
import * as profile from './profile/store.ts';
import { kvGet } from '../db.ts';
import * as x from './extras/store.ts';
import * as screen from './screentime/store.ts';
import * as car from './car/store.ts';

const safe = <T>(fn: () => T): T | { error: string } => {
  try { return fn(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
};

export const lifeSnapshot = (today = lifeToday()) => {
  const mode = safe(() => kvGet('mode') ?? 'Normal');
  return {
    day: today,
    mode,
    tasks: safe(() => ({ counts: tasks.counts(today), what_now: tasks.whatNow(today), capacity: tasks.capacity(today) })),
    habits: safe(() => tasks.listHabits(today)),
    goals: safe(() => tasks.listGoals()),
    money: safe(() => ({ week: money.summary(money.periodOf('week', today)), runway: money.runway(today) })),
    food: safe(() => { const d = food.foodDay(today); return { total: d.total, target: d.target, water_ml: d.water_ml }; }),
    gym: safe(() => gym.gymSummary(today)),
    body: safe(() => body.bodySummary(today)),
    asks_open: safe(() => profile.asksNext(3, today).map((a) => ({ key: a.key, question: a.question }))),
    next_anchor: safe(() => x.nextAnchor()),
    days_away: safe(() => x.daysAway(today)),
    rescue: safe(() => x.pushSilenced()),
    closed: safe(() => x.closedDay(today)),
    first_thing: safe(() => x.tomorrowFirst(today)),
    done: safe(() => x.doneList(today).counts),
    screentime: safe(() => screen.screenTimeGlance(today)),
    car: safe(() => car.carGlance(today)),
    note: 'Not done means nothing. Estimates only; nothing here is medical advice.',
  };
};
