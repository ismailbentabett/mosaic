// Dev only: fill a throwaway DB with realistic Phase 2 data so the web screens can be checked against the real API.
// Usage: MOSAIC_DEV=1 MOSAIC_DB=<tmp>/app.db MOSAIC_DATA=<tmp> MOSAIC_ROOT=<tmp> MOSAIC_VAULT=<tmp>/vault node --experimental-strip-types scripts/dev-seed.ts
// Never point it at the real app.db.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Guard: needs MOSAIC_DEV=1, an explicit MOSAIC_DB, and a path that is not the live one.
{
  const db = (process.env.MOSAIC_DB ?? '').replace(/\\/g, '/');
  const live = /(^|\/)mosaic\/(data\/)?app\.db$/i.test(db) || /^\/home\/[^/]+\/mosaic\//.test(db);
  if (process.env.MOSAIC_DEV !== '1' || !db || live) throw new Error('dev-seed: set MOSAIC_DEV=1 and MOSAIC_DB to a throwaway path (never the live app.db)');
}

const vault = process.env.MOSAIC_VAULT!;
mkdirSync(join(vault, 'Log'), { recursive: true });
if (!existsSync(join(vault, 'Emergency fund.md'))) writeFileSync(join(vault, 'Emergency fund.md'), '# Emergency fund\nThree months of costs. Placeholder about $3k.\n');
writeFileSync(join(vault, 'Proposal notes.md'), '# Proposal notes\nCafes answer a short message more than a long email. See [[Emergency fund]].\n');

const { lifeToday } = await import('../src/time.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const money = await import('../src/modules/money/store.ts');
const food = await import('../src/modules/food/store.ts');
const gym = await import('../src/modules/gym/store.ts');
const body = await import('../src/modules/body/store.ts');
const profile = await import('../src/modules/profile/store.ts');
const brain = await import('../src/modules/brain/store.ts');

const today = lifeToday();
const addDays = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const tryIt = (f: () => unknown) => { try { return f(); } catch (e) { console.warn('skip:', (e as Error).message); } };

profile.seedAsks();
money.seedCategories();

// Tasks
for (const p of ['Work', 'Learning', 'Admin', 'Personal']) tasks.ensureProject(p);
tasks.addTask({ id: 'seedrow-t1', title: 'Draft the project one-pager', project: 'Work', due_date: today, est_minutes: 50, priority: 3,
  first_action: 'Open a blank doc and write the title', done_def: 'One page, three sections' });
tasks.addTask({ id: 'seedrow-t2', title: 'Fix the login page layout', project: 'Work', due_date: today, est_minutes: 50, priority: 2 });
tasks.addTask({ id: 'seedrow-t3', title: 'Review weekly notes', project: 'Work', due_date: today, est_minutes: 45 });
tasks.addTask({ id: 'seedrow-t4', title: 'Watch course lesson 3', project: 'Learning', due_date: addDays(today, 1), est_minutes: 20 });
tasks.addTask({ id: 'seedrow-t5', title: 'Renew passport photo', project: 'Admin', due_date: addDays(today, -3) });
tasks.addTask({ id: 'seedrow-t6', title: 'Ask cousin about used car prices' });
tasks.addTask({ id: 'seedrow-t7', title: 'Read the site builder docs', someday: true });
tasks.quickAdd('call bank every mon');
tryIt(() => tasks.completeTask('seedrow-t3', today));

// Habits + goals
const habits = [['Read 10 pages', 7], ['Walk 20 min', 5], ['Stretch 10 min', 5], ['No phone in bed', 7]] as const;
for (const [n, t] of habits) tryIt(() => tasks.addHabit(n, t, 'seedrow-h-' + n.replace(/\W/g, '')));
for (let i = 0; i < 5; i++) tryIt(() => tasks.checkHabit('Read 10 pages', addDays(today, -i)));
tryIt(() => tasks.checkHabit('Walk 20 min', today));
tryIt(() => tasks.checkHabit('Stretch 10 min', addDays(today, -1)));
const g1 = tryIt(() => tasks.addGoal({ id: 'seedrow-g1', name: 'Emergency fund', why: 'Three months of costs', target_value: 3000, unit: 'USD', target_date: addDays(today, 270) })) as { id: string } | undefined;
if (g1) tasks.setGoalValue('seedrow-g1', 1000, today);
tryIt(() => tasks.addGoal({ id: 'seedrow-g2', name: 'Read six books', target_value: 6, unit: 'books', target_date: addDays(today, 90) }));
tryIt(() => tasks.setGoalValue('seedrow-g2', 0, today));

// Money
tryIt(() => money.addAccount({ id: 'seedrow-a1', name: 'Cash', currency: 'USD', opening_balance: 460 }));
tryIt(() => money.addAccount({ id: 'seedrow-a2', name: 'Bank', type: 'bank', currency: 'USD', opening_balance: 600 }));
tryIt(() => money.addAccount({ id: 'seedrow-a3', name: 'Work', currency: 'USD', track: 'business', opening_balance: 300 }));
const recs: [number, string, string, number, string?][] = [
  [3.5, 'Coffee', 'Cash', 0], [18, 'Groceries', 'Cash', -1], [20, 'Software/Claude', 'Bank', -2],
  [6, 'Transport', 'Cash', -2], [11.5, 'Restaurants', 'Cash', -4], [24.5, 'Groceries', 'Cash', -6],
  [12, 'Software/Domains', 'Work', -3],
];
recs.forEach(([amount, category, account, d], i) => tryIt(() => money.addRecord({ id: 'seedrow-r' + i, amount, category, account, day: addDays(today, d), note: category.split('/').pop()!.toLowerCase() })));
tryIt(() => money.addBudget({ id: 'seedrow-b1', name: 'Groceries', categories: ['Groceries'], amount_usd: 60, period: 'month' } as never));
tryIt(() => money.addSavingsGoal({ id: 'seedrow-s1', name: 'Emergency fund', target_usd: 3000, saved_usd: 1000, target_date: addDays(today, 270) } as never));
tryIt(() => money.addShopping('Eggs', undefined, '12', 'seedrow-sh1'));
tryIt(() => money.addShopping('Olive oil', undefined, undefined, 'seedrow-sh2'));

// Food
const foods = [
  { id: 'seedrow-f1', name: 'Eggs, whole', kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, source: 'ciqual' },
  { id: 'seedrow-f2', name: 'Bread, baguette', kcal: 270, protein: 9, carbs: 54, fat: 1.5, source: 'ciqual' },
  { id: 'seedrow-f3', name: 'Chicken breast, cooked', kcal: 165, protein: 31, carbs: 0, fat: 3.6, source: 'usda' },
  { id: 'seedrow-f4', name: 'Rice, cooked', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, source: 'usda' },
  { id: 'seedrow-f5', name: 'Dates, deglet nour', kcal: 282, protein: 2.5, carbs: 75, fat: 0.4, source: 'ciqual' },
];
for (const f of foods) tryIt(() => food.addFood(f as never));
tryIt(() => food.setTargets({ from_day: addDays(today, -30), kcal: 2400, protein: 150, carbs: 260, fat: 80, method: 'manual' }));
tryIt(() => food.logFood({ id: 'seedrow-l1', day: today, slot: 'breakfast', food: 'seedrow-f1', grams: 120 }));
tryIt(() => food.logFood({ id: 'seedrow-l2', day: today, slot: 'breakfast', food: 'seedrow-f2', grams: 80 }));
tryIt(() => food.logFood({ id: 'seedrow-l3', day: today, slot: 'lunch', food: 'seedrow-f3', grams: 200 }));
tryIt(() => food.logFood({ id: 'seedrow-l4', day: today, slot: 'lunch', food: 'seedrow-f4', grams: 250 }));
tryIt(() => food.logFood({ id: 'seedrow-l5', day: today, slot: 'snacks', name: 'Pastry', kcal: 320, estimate: true }));
tryIt(() => food.addWater(500, today, 'seedrow-w1'));

// Gym
const exs = [['Bench press', ['chest'], 'barbell'], ['Squat', ['quads'], 'barbell'], ['Lat pulldown', ['lats'], 'cable'], ['Overhead press', ['shoulders'], 'barbell']] as const;
for (const [n, m, e] of exs) tryIt(() => gym.addExercise({ id: 'seedrow-e-' + n.replace(/\W/g, ''), name: n, primary_muscles: [...m], equipment: e, increment: 2.5 }));
tryIt(() => gym.addRoutine({ id: 'seedrow-rt1', name: 'Push', items: [{ exercise: 'Bench press', sets: 3, rep_min: 6, rep_max: 10, rest_s: 150 }, { exercise: 'Overhead press', sets: 3, rep_min: 8, rep_max: 12 }] }));
tryIt(() => gym.addRoutine({ id: 'seedrow-rt2', name: 'Legs + pull', items: [{ exercise: 'Squat', sets: 3, rep_min: 5, rep_max: 8 }, { exercise: 'Lat pulldown', sets: 3 }] }));
for (const [d, w] of [[-6, 60], [-3, 62.5]] as const) {
  const at = new Date(addDays(today, d) + 'T18:40:00Z').toISOString();
  const wk = tryIt(() => gym.startWorkout({ id: 'seedrow-wk' + d, routine: 'Push', at })) as { id: string } | undefined;
  if (!wk) continue;
  for (let s = 0; s < 3; s++) tryIt(() => gym.logSet({ id: `seedrow-s${d}-${s}`, workout_id: wk.id, exercise: 'Bench press', weight: w, reps: 8 - s, at }));
  tryIt(() => gym.logSet({ id: `seedrow-s${d}-o`, workout_id: wk.id, exercise: 'Overhead press', weight: 40, reps: 10, at }));
  tryIt(() => gym.finishWorkout(wk.id, undefined, new Date(new Date(at).getTime() + 70 * 60_000)));
}

// Body
for (let i = 20; i >= 0; i -= 1) if (i % 2 === 0 || i < 4) tryIt(() => body.logMetric({ id: 'seedrow-bw' + i, day: addDays(today, -i), kind: 'weight', value: +(78.6 - (20 - i) * 0.05 + ((i * 7) % 5) * 0.12).toFixed(1) }));
tryIt(() => body.logMetric({ id: 'seedrow-waist', day: addDays(today, -2), kind: 'waist', value: 86, unit: 'cm' }));

// People, thrift, habitat (migrations v10–v13)
const people = await import('../src/modules/people/store.ts');
const thrift = await import('../src/modules/thrift/store.ts');
const habitat = await import('../src/modules/habitat/store.ts');
tryIt(() => people.addPerson({ id: 'seedrow-p1', name: 'Mom', relation: 'family', cadence_days: 2, last_contact: addDays(today, -3) }));
tryIt(() => people.addPerson({ id: 'seedrow-p2', name: 'Karim', relation: 'friend', cadence_days: 14, last_contact: addDays(today, -20) }));
tryIt(() => people.addPromise({ id: 'seedrow-pr1', who: 'Karim', what: 'Send him the car listing', due: addDays(today, 1) }));
tryIt(() => people.addOccasion({ id: 'seedrow-o1', name: "Amina's birthday", kind: 'birthday', md: addDays(today, 5).slice(5), person_id: undefined }));
tryIt(() => people.writeCapsule({ id: 'seedrow-c1', title: 'To November me', body: 'You started the app this week. Keep it boring.', open_on: addDays(today, 1) }));
tryIt(() => thrift.logSkippedBuy({ id: 'seedrow-sk1', name: 'Wireless earbuds', amount: 50, currency: 'USD', day: addDays(today, -2) }));
tryIt(() => habitat.addLastDone('Change bed sheets', { id: 'seedrow-ld1' }));
tryIt(() => habitat.stampLastDone('Change bed sheets', new Date(addDays(today, -9) + 'T12:00:00Z').toISOString(), 'seedrow-ld1'));
tryIt(() => habitat.addLastDone('Clean phone screen', { id: 'seedrow-ld2' }));
tryIt(() => habitat.addLent({ id: 'seedrow-le1', thing: 'Drill', person: 'Karim', direction: 'lent', since: addDays(today, -12) } as never));
tryIt(() => habitat.addHelped({ id: 'seedrow-he1', situation: 'stuck', thing: 'Walk 10 min, then open the first priority' }));
tryIt(() => habitat.startExperiment({ id: 'seedrow-ex1', name: 'No phone before breakfast', days: 14, start_day: addDays(today, -3) }));

tryIt(() => brain.scanVault());
console.log('seeded', today);
