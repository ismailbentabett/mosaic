// /api/v2: JSON routes for the Phase 2 modules. Auth + body limit come from the parent app.
// Every create accepts a client `id` (uuid) so offline replays are idempotent.
import { Hono, type Context } from 'hono';
import { AppError } from '../errors.ts';
import { isDate, lifeToday } from '../time.ts';
import * as tasks from './tasks/store.ts';
import * as money from './money/store.ts';
import * as food from './food/store.ts';
import * as imports from './imports.ts';
import * as gym from './gym/store.ts';
import * as body from './body/store.ts';
import * as profile from './profile/store.ts';
import * as brain from './brain/store.ts';
import { lifeSnapshot } from './life.ts';
import * as screen from './screentime/store.ts';
import * as x from './extras/store.ts';
import * as ideas from './ideas/store.ts';
import * as people from './people/store.ts';
import * as thrift from './thrift/store.ts';
import * as habitat from './habitat/store.ts';
import * as grades from './grades/store.ts';
import * as car from './car/store.ts';
import { toCsv } from './util.ts';
import { expireRescueMode } from '../modeState.ts';
import * as pc from '../pushCenter.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type B = Record<string, any>;
const json = async (c: Context): Promise<B> => {
  try {
    const v = await c.req.json();
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v as B;
  } catch { throw new AppError('bad_request', 'Body must be a JSON object'); }
};
const q = (c: Context, k: string) => c.req.query(k) || undefined;
const qn = (c: Context, k: string) => { const v = q(c, k); if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) throw new AppError('bad_request', `${k} must be a number`); return n; };
// A date query param: absent → undefined, malformed or impossible (2026-02-30) → 400.
const qd = (c: Context, k: string) => { const v = q(c, k); if (v !== undefined && !isDate(v)) throw new AppError('bad_request', `${k} must be a date YYYY-MM-DD`); return v; };
const dayQ = (c: Context) => qd(c, 'day') ?? lifeToday();
const csvBody = async (c: Context) => {
  const t = await c.req.text();
  if (!t.trim()) throw new AppError('bad_request', 'Send the CSV as the request body');
  return t;
};
const dry = (c: Context) => q(c, 'dry_run') === '1' || q(c, 'dry_run') === 'true';

export const modulesRouter = () => {
  const r = new Hono();

  // ---------- Life + profile ----------
  r.get('/life', async (c) => { await expireRescueMode().catch(() => null); return c.json(lifeSnapshot(dayQ(c))); });
  r.get('/profile', (c) => c.json(profile.profileGet(q(c, 'prefix') ?? '')));
  r.get('/asks', (c) => c.json(profile.asksNext(qn(c, 'n') ?? 1, dayQ(c))));
  r.post('/asks/:ref/answer', async (c) => c.json(profile.asksAnswer(c.req.param('ref'), (await json(c)).value)));
  r.post('/asks/:ref/skip', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(profile.asksSkip(c.req.param('ref'), b.days ?? 7)); });

  // ---------- Tasks ----------
  r.get('/tasks', (c) => c.json(tasks.listTasks({ view: q(c, 'view') as tasks.View | undefined, project: q(c, 'project'), tag: q(c, 'tag'),
    q: q(c, 'q'), limit: qn(c, 'limit'), today: q(c, 'today') })));
  r.get('/tasks/counts', (c) => c.json(tasks.counts(dayQ(c))));
  r.get('/tasks/now', (c) => c.json({ what_now: tasks.whatNow(dayQ(c)), capacity: tasks.capacity(dayQ(c), qn(c, 'free') ?? 300) }));
  r.post('/tasks', async (c) => {
    const b = await json(c);
    const t = b.text ? tasks.quickAdd(String(b.text), b as tasks.TaskInput) : tasks.addTask({ ...b, source: b.source ?? 'app' } as tasks.TaskInput & { title: string });
    let similar: ReturnType<typeof ideas.similarTasks> = [];
    try { similar = ideas.similarTasks(t.title, t.id); } catch { /* never block a capture */ }
    return c.json({ ...t, similar }, 201);
  });
  r.post('/tasks/set-day', async (c) => { const b = await json(c); return c.json(tasks.setDay(b.ids ?? [], b.day ?? null)); });
  r.post('/tasks/purge', async (c) => c.json(tasks.purgeTasks((await json(c)).days ?? 30)));
  r.get('/tasks/:ref', (c) => { const t = tasks.resolveRef(c.req.param('ref')); return c.json({ ...t, subtasks: tasks.subtasks(t.id) }); });
  r.patch('/tasks/:ref', async (c) => c.json(tasks.updateTask(c.req.param('ref'), await json(c) as tasks.TaskInput)));
  r.post('/tasks/:ref/done', (c) => c.json(tasks.completeTask(c.req.param('ref'), dayQ(c))));
  // One-off: due moves to tomorrow (prev_due comes back for undo). Recurring: this occurrence is skipped.
  r.post('/tasks/:ref/skip', (c) => c.json(tasks.skipTask(c.req.param('ref'), dayQ(c))));
  r.get('/done/month', (c) => c.json(tasks.doneThisMonth(dayQ(c))));
  r.post('/tasks/:ref/reopen', (c) => c.json(tasks.reopenTask(c.req.param('ref'))));
  r.post('/tasks/:ref/restore', (c) => c.json(tasks.restoreTask(c.req.param('ref'))));
  r.delete('/tasks/:ref', (c) => c.json(tasks.deleteTask(c.req.param('ref'))));
  r.post('/tasks/:ref/focus', async (c) => { const b = await json(c); return c.json(tasks.logFocus(tasks.resolveRef(c.req.param('ref')).id, b.minutes, b.started_at, b.id, b.paused_ms, b.pause_reason)); });
  r.get('/areas', (c) => c.json(tasks.listAreas()));
  r.post('/areas', async (c) => { const b = await json(c); return c.json(tasks.addArea(b.name, b.id), 201); });
  r.get('/projects', (c) => c.json(tasks.listProjects(q(c, 'archived') === '1')));
  r.post('/projects', async (c) => { const b = await json(c); return c.json(tasks.ensureProject(b.name, b), 201); });
  r.patch('/projects/:ref', async (c) => c.json(tasks.updateProject(c.req.param('ref'), await json(c))));
  r.get('/tasks-export', (c) => c.body(toCsv(tasks.exportTasks()), 200, { 'content-type': 'text/csv; charset=utf-8' }));

  // ---------- Habits + goals ----------
  r.get('/habits', (c) => c.json(tasks.listHabits(dayQ(c))));
  r.post('/habits', async (c) => { const b = await json(c); return c.json(tasks.addHabit(b.name, b.target_per_week ?? 7, b.id), 201); });
  r.patch('/habits/:ref', async (c) => c.json(tasks.updateHabit(c.req.param('ref'), await json(c))));
  r.post('/habits/:ref/check', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(tasks.checkHabit(c.req.param('ref'), b.day ?? dayQ(c), b.count ?? 1)); });
  r.get('/goals', (c) => c.json(tasks.listGoals(q(c, 'status') ?? 'active')));
  r.post('/goals', async (c) => c.json(tasks.addGoal(await json(c) as never), 201));
  r.post('/goals/:id/value', async (c) => { const b = await json(c); return c.json(tasks.setGoalValue(c.req.param('id'), b.value, b.day ?? dayQ(c))); });

  // ---------- Money ----------
  r.get('/money/accounts', (c) => c.json(money.listAccounts(q(c, 'archived') === '1').map((a) => ({ ...a, balance: money.balance(String(a.id)) }))));
  r.post('/money/accounts', async (c) => c.json(money.addAccount(await json(c) as never), 201));
  r.patch('/money/accounts/:id', async (c) => c.json(money.updateAccount(c.req.param('id'), await json(c) as never)));
  r.get('/money/categories', (c) => c.json(money.listCategories()));
  r.get('/money/rates', (c) => c.json(money.listRates()));
  r.post('/money/rates', async (c) => { const b = await json(c); return c.json(money.setRate(b.currency, b.to_usd, b.day ?? lifeToday())); });
  r.get('/money/records', (c) => c.json(money.listRecords({ from: q(c, 'from'), to: q(c, 'to'), account: q(c, 'account'), category: q(c, 'category'), q: q(c, 'q'), kind: q(c, 'kind'), limit: qn(c, 'limit') })));
  r.post('/money/records', async (c) => { const b = await json(c); return c.json(b.text ? money.quickLog(String(b.text), b) : b.structured ? money.logRecord(b as money.RecordInput) : money.addRecord(b as money.RecordInput), 201); });
  r.post('/money/transfer', async (c) => c.json(money.transfer(await json(c) as never), 201));
  r.get('/money/records/:id', (c) => c.json(money.getRecord(c.req.param('id'))));
  r.patch('/money/records/:id', async (c) => c.json(money.updateRecord(c.req.param('id'), await json(c) as never)));
  r.delete('/money/records/:id', (c) => c.json(money.deleteRecord(c.req.param('id'))));
  r.get('/money/summary', (c) => c.json(money.summary(money.periodOf((q(c, 'period') ?? 'month') as 'week' | 'month' | 'year', dayQ(c)), (q(c, 'track') ?? 'personal') as 'personal' | 'business')));
  r.get('/money/runway', (c) => c.json(money.runway(dayQ(c))));
  r.get('/money/budgets', (c) => c.json(money.listBudgets(dayQ(c) as never)));
  r.post('/money/budgets', async (c) => c.json(money.addBudget(await json(c) as never), 201));
  r.post('/money/budgets/weekly', async (c) => c.json(money.setWeeklyBudget(Number((await json(c)).amount_usd))));
  r.patch('/money/budgets/:id', async (c) => c.json(money.updateBudget(c.req.param('id'), await json(c) as never)));
  r.delete('/money/budgets/:id', (c) => c.json(money.deleteBudget(c.req.param('id'))));
  r.get('/money/templates', (c) => c.json(money.listTemplates()));
  r.post('/money/templates', async (c) => { const b = await json(c); return c.json(money.addTemplate(b.name, b.record, b.id), 201); });
  r.post('/money/templates/:ref/use', async (c) => c.json(money.useTemplate(c.req.param('ref'), await json(c).catch(() => ({}))), 201));
  r.get('/money/planned', (c) => c.json(money.listPlanned()));
  r.post('/money/planned', async (c) => c.json(money.addPlanned(await json(c) as never), 201));
  r.post('/money/planned/:id/post', async (c) => c.json(money.postPlanned(c.req.param('id'), await json(c).catch(() => ({})) as never)));
  r.post('/money/planned/:id/skip', (c) => c.json(money.skipPlanned(c.req.param('id'))));
  r.get('/money/debts', (c) => c.json(money.listDebts()));
  r.post('/money/debts', async (c) => c.json(money.addDebt(await json(c) as never), 201));
  r.post('/money/debts/:id/repay', async (c) => { const b = await json(c); return c.json(money.repayDebt(c.req.param('id'), Number(b.amount), b.account)); });
  r.get('/money/savings', (c) => c.json(money.listSavingsGoals()));
  r.post('/money/savings', async (c) => c.json(money.addSavingsGoal(await json(c) as never), 201));
  r.patch('/money/savings/:id', async (c) => c.json(money.updateSavingsGoal(c.req.param('id'), await json(c) as never)));
  r.delete('/money/savings/:id', (c) => c.json(money.deleteSavingsGoal(c.req.param('id'))));
  r.get('/shopping', (c) => c.json(money.listShopping(q(c, 'list'), q(c, 'done') !== '0')));
  r.post('/shopping', async (c) => { const b = await json(c); return c.json(money.addShopping(b.name, b.list, b.qty, b.id), 201); });
  r.post('/shopping/:id/toggle', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(money.toggleShopping(c.req.param('id'), b.done ?? true)); });
  r.post('/shopping/clear-done', (c) => c.json({ cleared: money.clearDoneShopping(q(c, 'list')) }));
  r.get('/money/export', (c) => c.body(toCsv(money.exportRecords()), 200, { 'content-type': 'text/csv; charset=utf-8' }));
  r.post('/money/import/wallet', async (c) => c.json(money.importWallet(await csvBody(c), dry(c))));
  r.post('/money/import/ynab', async (c) => c.json(imports.importYnab(await csvBody(c), { currency: q(c, 'currency') || undefined, dryRun: dry(c) })));
  r.post('/tasks/import/todoist', async (c) => c.json(imports.importTodoist(await csvBody(c), { project: q(c, 'project') || undefined, dryRun: dry(c) })));

  // ---------- Food ----------
  r.get('/food/search', (c) => c.json(food.searchFoods(q(c, 'q') ?? '', qn(c, 'limit') ?? 25)));
  r.get('/food/barcode/:code', async (c) => c.json(await food.lookupBarcode(c.req.param('code'))));
  r.post('/food/foods', async (c) => c.json(food.addFood(await json(c) as never), 201));
  r.get('/food/foods/:id', (c) => c.json(food.getFood(c.req.param('id'))));
  r.patch('/food/foods/:id', async (c) => c.json(food.updateFood(c.req.param('id'), await json(c) as never)));
  r.delete('/food/foods/:id', (c) => c.json(food.deleteFood(c.req.param('id'))));
  r.post('/food/foods/:id/servings', async (c) => { const b = await json(c); return c.json(food.addServing(c.req.param('id'), b.label, b.grams), 201); });
  r.get('/food/recipes', (c) => c.json(food.listRecipes()));
  r.post('/food/recipes', async (c) => c.json(food.addRecipe(await json(c) as never), 201));
  r.get('/food/recipes/:id', (c) => c.json(food.getRecipe(c.req.param('id'))));
  r.get('/food/day', (c) => c.json(food.foodDay(dayQ(c))));
  r.post('/food/log', async (c) => c.json(food.logFood(await json(c) as food.LogIn), 201));
  r.patch('/food/log/:id', async (c) => c.json(food.updateLog(c.req.param('id'), await json(c) as never)));
  r.delete('/food/log/:id', (c) => c.json(food.deleteLog(c.req.param('id'))));
  r.post('/food/water', async (c) => { const b = await json(c).catch(() => ({} as B)); const day = b.day ?? dayQ(c); return c.json({ day, water_ml: food.addWater(b.ml ?? 250, day, b.id) }, 201); });
  r.post('/food/day-status', async (c) => { const b = await json(c); return c.json(food.setDayStatus(b.day ?? dayQ(c), b.status)); });
  r.post('/food/targets', async (c) => c.json(food.setTargets(await json(c) as never)));
  r.get('/food/meals', (c) => c.json(food.listMeals()));
  r.post('/food/meals', async (c) => { const b = await json(c); return c.json(food.saveMeal(b.name, b.day ?? dayQ(c), b.slot), 201); });
  r.post('/food/meals/:ref/log', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(food.logMeal(c.req.param('ref'), b.day ?? dayQ(c), b.slot), 201); });
  r.post('/food/copy-meal', async (c) => { const b = await json(c); return c.json(food.copyMeal(b.from_day, b.to_day ?? dayQ(c), b.slot, b.to_slot), 201); });
  r.get('/food/range', (c) => c.json(food.range(q(c, 'from') ?? dayQ(c), q(c, 'to') ?? dayQ(c))));
  r.get('/food/tdee', (c) => c.json({ adaptive: food.adaptiveTdee(dayQ(c)), suggestion: food.suggestTarget(qn(c, 'rate') ?? 0, qn(c, 'protein_per_kg') ?? 1.8, dayQ(c)) }));
  r.post('/food/import/mfp', async (c) => c.json(food.importMfp(await csvBody(c), dry(c))));

  // ---------- Gym ----------
  r.get('/gym/exercises', (c) => c.json(gym.searchExercises(q(c, 'q') ?? '', q(c, 'muscle'), q(c, 'equipment'), qn(c, 'limit') ?? 50)));
  r.post('/gym/exercises', async (c) => c.json(gym.addExercise(await json(c) as never), 201));
  r.get('/gym/exercises/:id', (c) => c.json(gym.getExercise(c.req.param('id'))));
  r.delete('/gym/exercises/:id', (c) => c.json({ result: gym.removeExercise(c.req.param('id')) }));
  r.get('/gym/exercises/:ref/history', (c) => c.json({ history: gym.exerciseHistory(c.req.param('ref')), prs: gym.listPrs(c.req.param('ref')),
    last: gym.lastPerformance(c.req.param('ref')), next: gym.suggestNext(c.req.param('ref'), qn(c, 'rep_min') ?? 8, qn(c, 'rep_max') ?? 12, q(c, 'deload') === '1') }));
  r.get('/gym/routines', (c) => c.json(gym.listRoutines()));
  r.post('/gym/routines', async (c) => c.json(gym.addRoutine(await json(c) as never), 201));
  r.get('/gym/routines/:id', (c) => c.json(gym.getRoutine(c.req.param('id'))));
  r.put('/gym/routines/:id/items', async (c) => { const id = String(gym.getRoutine(c.req.param('id')).id); gym.setRoutineItems(id, (await json(c)).items ?? []); return c.json(gym.getRoutine(id)); });
  r.get('/gym/active', (c) => c.json({ workout: gym.activeWorkout(), rest: gym.getRest() }));
  r.get('/gym/workouts', (c) => c.json(gym.listWorkouts(q(c, 'from'), q(c, 'to'), qn(c, 'limit') ?? 50)));
  r.post('/gym/workouts', async (c) => c.json(gym.startWorkout(await json(c).catch(() => ({}))), 201));
  r.get('/gym/workouts/:id', (c) => c.json(gym.getWorkout(c.req.param('id'))));
  r.post('/gym/workouts/:id/finish', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(gym.finishWorkout(c.req.param('id'), b.notes, b.at ? new Date(b.at) : new Date())); });
  r.delete('/gym/workouts/:id', (c) => c.json(gym.deleteWorkout(c.req.param('id'))));
  r.post('/gym/sets', async (c) => c.json(gym.logSet(await json(c) as gym.SetIn), 201));
  r.patch('/gym/sets/:id', async (c) => c.json(gym.updateSet(c.req.param('id'), await json(c) as never)));
  r.delete('/gym/sets/:id', (c) => c.json(gym.deleteSet(c.req.param('id'))));
  r.post('/gym/rest', async (c) => { const b = await json(c); return c.json(gym.startRest(b.seconds, b.label)); });
  r.delete('/gym/rest', (c) => c.json(gym.clearRest()));
  r.get('/gym/volume', (c) => c.json(gym.muscleVolume(qd(c, 'week') ?? dayQ(c))));
  r.get('/gym/warmup', (c) => c.json(gym.warmup(qn(c, 'weight') ?? 0)));
  r.get('/gym/plates', (c) => c.json(gym.plates(qn(c, 'weight') ?? 0, qn(c, 'bar') ?? 20)));
  r.get('/gym/summary', (c) => c.json(gym.gymSummary(dayQ(c))));
  r.post('/gym/import/strong', async (c) => c.json(gym.importStrong(await csvBody(c), dry(c), (q(c, 'unit') ?? 'kg') as 'kg' | 'lb')));
  r.post('/gym/import/hevy', async (c) => c.json(gym.importHevy(await csvBody(c), dry(c))));

  // ---------- Body ----------
  r.get('/body', (c) => c.json(body.bodySummary(dayQ(c))));
  r.get('/body/metrics', (c) => c.json(body.listMetrics(q(c, 'kind') ?? 'weight', q(c, 'from'), q(c, 'to'))));
  r.post('/body/metrics', async (c) => c.json(body.logMetric(await json(c) as never), 201));
  r.delete('/body/metrics/:id', (c) => c.json(body.deleteMetric(c.req.param('id'))));

  // ---------- Brain ----------
  r.get('/brain/search', (c) => c.json(brain.brainSearch(q(c, 'q') ?? '', { kinds: q(c, 'kinds')?.split(',') as brain.Hit['kind'][] | undefined, limit: qn(c, 'limit') })));
  r.post('/brain/scan', (c) => c.json(brain.scanVault()));
  r.get('/brain/backlinks', (c) => c.json(brain.backlinks(q(c, 'path') ?? '')));

  // ---------- Backlog extras ----------
  r.get('/timer/guard', (c) => c.json(x.timerGuard(qn(c, 'minutes') ?? 50)));
  r.get('/clock', (c) => c.json(x.clock()));
  r.get('/done', (c) => { const from = q(c, 'from') ?? dayQ(c); return c.json(x.doneList(from, q(c, 'to') ?? from)); });
  r.post('/rescue', async (c) => c.json(await x.rescue()));
  r.post('/rescue/end', async (c) => c.json(await x.endRescue()));
  r.post('/rescue/keep', (c) => c.json(x.keepRescue()));
  r.get('/badday', (c) => c.json({ items: x.getBadday() }));
  r.put('/badday', async (c) => c.json({ items: x.setBadday((await json(c)).items) }));
  r.get('/close-day', (c) => c.json({ closed: x.closedDay(dayQ(c)), tomorrow_first: x.tomorrowFirst(dayQ(c)) }));
  r.post('/close-day', async (c) => c.json(x.closeDay(await json(c) as never)));
  r.get('/documents', (c) => c.json(x.listDocuments(dayQ(c), { car_id: c.req.query('car') || undefined, tag: c.req.query('tag') || undefined })));
  r.post('/documents', async (c) => c.json(x.addDocument(await json(c) as never), 201));
  r.patch('/documents/:id', async (c) => c.json(x.updateDocument(c.req.param('id'), await json(c) as never)));
  r.delete('/documents/:id', (c) => c.json(x.deleteDocument(c.req.param('id'))));
  r.get('/wishlist', (c) => c.json(x.listWishlist(q(c, 'status') ?? 'open')));
  r.post('/wishlist', async (c) => c.json(x.addWish(await json(c) as never), 201));
  r.post('/wishlist/:id/status', async (c) => c.json(x.setWishStatus(c.req.param('id'), (await json(c)).status)));
  r.delete('/wishlist/:id', (c) => c.json(x.deleteWish(c.req.param('id'))));
  r.get('/afford', (c) => c.json(x.afford(qn(c, 'amount') ?? 0, q(c, 'currency') ?? 'USD', dayQ(c), q(c, 'from'))));
  r.get('/money/price-memory', (c) => c.json(x.priceMemory(q(c, 'q') ?? '', qn(c, 'limit') ?? 20)));
  r.get('/tasks-estimates', (c) => c.json(x.estimates()));
  r.get('/tasks-estimates/hint', (c) => c.json(x.estimateHint(qn(c, 'minutes') ?? 0, (q(c, 'tags') ?? '').split(',').filter(Boolean))));
  r.get('/cards', (c) => c.json(x.listCards(q(c, 'deck'), qn(c, 'limit') ?? 200)));
  r.get('/cards/queue', (c) => c.json(x.cardQueue(qn(c, 'limit') ?? 20)));
  r.post('/cards/draft', async (c) => c.json(x.draftCard(String((await json(c)).text ?? ''))));
  r.post('/cards', async (c) => c.json(x.addCard(await json(c) as never), 201));
  r.get('/cards/:id', (c) => c.json(x.getCard(c.req.param('id'))));
  r.post('/cards/:id/review', async (c) => c.json(x.reviewCard(c.req.param('id'), Number((await json(c)).grade))));
  r.delete('/cards/:id', (c) => c.json(x.deleteCard(c.req.param('id'))));
  r.post('/brain-dump', async (c) => c.json({ items: x.brainDumpDraft(String((await json(c)).text ?? '')) }));
  r.post('/brain-dump/commit', async (c) => c.json(await x.brainDumpCommit((await json(c)).items)));
  r.get('/park', (c) => c.json(x.parked()));
  r.post('/park', async (c) => c.json(x.park(String((await json(c)).text ?? '')), 201));
  r.post('/food/seed-local', (c) => c.json(x.seedLocalFoods()));
  r.get('/weather', async (c) => c.json(await x.weather()));
  r.get('/gym/today-routine', (c) => c.json(x.todayRoutine()));
  r.get('/days-away', (c) => c.json(x.daysAway(dayQ(c))));

  // ---------- Ideas round 1 ----------
  r.get('/questions', (c) => c.json(ideas.listQuestions(q(c, 'status'), qn(c, 'limit') ?? 50)));
  r.post('/questions', async (c) => { const b = await json(c); return c.json(ideas.addQuestion(String(b.text ?? ''), b.id), 201); });
  r.patch('/questions/:id', async (c) => c.json(ideas.updateQuestion(c.req.param('id'), await json(c) as never)));
  r.post('/questions/:id/answer', async (c) => c.json(await ideas.answerQuestion(c.req.param('id'), String((await json(c)).answer_md ?? ''))));
  r.get('/fits', (c) => c.json(ideas.fits()));
  r.get('/tasks-similar', (c) => c.json(ideas.similarTasks(q(c, 'title') ?? '', q(c, 'except'))));
  r.post('/tasks/:ref/merge-into/:keep', (c) => c.json(ideas.mergeTasks(c.req.param('keep'), c.req.param('ref'))));
  r.get('/compost', (c) => c.json({ items: ideas.composted(), preview: ideas.compost(new Date(), ideas.COMPOST_DAYS, true) }));
  r.post('/compost/run', (c) => c.json(ideas.compost()));
  r.post('/compost/:ref/restore', (c) => c.json(ideas.restoreComposted(c.req.param('ref'))));
  r.get('/triage', (c) => c.json(ideas.triage(dayQ(c))));
  r.post('/triage/:ref', async (c) => { const b = await json(c); return c.json(ideas.triageDecide(c.req.param('ref'), b.action, b, dayQ(c))); });

  // ---------- People (promises, tiny habits, capsules, people, occasions, waiting, week facts) ----------
  r.get('/promises', (c) => c.json(people.listPromises((q(c, 'status') ?? 'open') as never, qn(c, 'limit') ?? 100)));
  r.get('/promises/soon', (c) => c.json(people.promisesSoon(dayQ(c), q(c, 'screen') === '1')));
  r.post('/promises', async (c) => c.json(people.addPromise(await json(c) as never), 201));
  r.patch('/promises/:id', async (c) => c.json(people.updatePromise(c.req.param('id'), await json(c) as never)));
  r.post('/promises/:id/keep', (c) => c.json(people.keepPromise(c.req.param('id'), q(c, 'day'))));
  r.post('/promises/:id/release', (c) => c.json(people.releasePromise(c.req.param('id'), q(c, 'day'))));
  r.post('/promises/:id/reopen', (c) => c.json(people.reopenPromise(c.req.param('id'))));
  r.delete('/promises/:id', (c) => c.json(people.deletePromise(c.req.param('id'))));
  r.put('/habits/:ref/tiny', async (c) => { const b = await json(c); return c.json(people.setTiny(c.req.param('ref'), b.tiny ?? null)); });
  r.post('/habits/:ref/tiny-check', (c) => c.json(people.checkTiny(c.req.param('ref'), q(c, 'day'))));
  r.post('/habits/:ref/full-check', (c) => c.json(people.checkFull(c.req.param('ref'), q(c, 'day'))));
  r.get('/habits/:ref/tiny-stats', (c) => { const to = q(c, 'to') ?? lifeToday(); return c.json(people.tinyStats(c.req.param('ref'), q(c, 'from') ?? to, to)); });
  r.get('/capsules', (c) => c.json(people.listCapsules(q(c, 'day'))));
  r.get('/capsules/due', (c) => c.json(people.capsulesDue(q(c, 'day'), q(c, 'screen') === '1')));
  r.post('/capsules', async (c) => c.json(people.writeCapsule(await json(c) as never), 201));
  r.get('/capsules/:id', (c) => c.json(people.getCapsule(c.req.param('id'), q(c, 'day'))));
  r.post('/capsules/:id/open', (c) => c.json(people.openCapsule(c.req.param('id'), q(c, 'day'))));
  r.delete('/capsules/:id', (c) => c.json(people.deleteCapsule(c.req.param('id'))));
  r.get('/people', (c) => c.json(people.listPeople(q(c, 'relation'))));
  r.get('/people/due', (c) => c.json(people.peopleDue(q(c, 'day'), q(c, 'screen') === '1')));
  r.post('/people', async (c) => c.json(people.addPerson(await json(c) as never), 201));
  r.patch('/people/:ref', async (c) => c.json(people.updatePerson(c.req.param('ref'), await json(c) as never)));
  r.delete('/people/:ref', (c) => c.json(people.deletePerson(c.req.param('ref'))));
  r.post('/people/:ref/touch', async (c) => { const b = await json(c).catch(() => ({} as B)); return c.json(people.touch(c.req.param('ref'), b.day, b.note ?? '')); });
  r.get('/people/:ref/contacts', (c) => c.json(people.contactsOf(c.req.param('ref'), qn(c, 'limit') ?? 50)));
  r.get('/occasions', (c) => c.json(people.listOccasions()));
  r.get('/occasions/soon', (c) => c.json(people.occasionsSoon(q(c, 'day'), qn(c, 'within') ?? 14)));
  r.post('/occasions', async (c) => c.json(people.addOccasion(await json(c) as never), 201));
  r.patch('/occasions/:id', async (c) => c.json(people.updateOccasion(c.req.param('id'), await json(c) as never)));
  r.delete('/occasions/:id', (c) => c.json(people.deleteOccasion(c.req.param('id'))));
  r.get('/waiting', (c) => c.json(people.waitingList()));
  r.get('/waiting/due', (c) => c.json(people.waitingDue(q(c, 'day'), q(c, 'screen') === '1')));
  r.put('/waiting/:ref/check-on', async (c) => c.json(people.setCheckOn(c.req.param('ref'), await json(c) as never)));
  r.get('/week-facts', (c) => c.json(people.weekFacts(q(c, 'week'))));
  r.get('/strip14', (c) => c.json(people.strip14(q(c, 'day'))));

  // ---------- Thrift ----------
  r.post('/thrift/recipe-to-shopping', async (c) => { const b = await json(c); return c.json(thrift.recipeToShopping(String(b.recipe ?? ''), Number(b.portions), b)); });
  r.get('/thrift/recurring', (c) => c.json(thrift.recurringCosts({ from: q(c, 'from'), to: q(c, 'to') })));
  r.get('/thrift/skipped', (c) => c.json({ items: thrift.listSkippedBuys({ from: q(c, 'from'), to: q(c, 'to') }), summary: thrift.skippedSummary({ from: q(c, 'from'), to: q(c, 'to') }) }));
  r.post('/thrift/skipped', async (c) => c.json(thrift.logSkippedBuy(await json(c) as never), 201));
  r.delete('/thrift/skipped/:id', (c) => c.json(thrift.deleteSkippedBuy(c.req.param('id'))));
  r.get('/records/:id/for', (c) => c.json({ record_id: c.req.param('id'), who: thrift.getRecordFor(c.req.param('id')) }));
  r.put('/records/:id/for', async (c) => { const who = (await json(c)).who; return c.json(who ? thrift.setRecordFor(c.req.param('id'), String(who)) : thrift.clearRecordFor(c.req.param('id'))); });
  r.get('/thrift/by-who', (c) => { const to = q(c, 'to') ?? lifeToday(); return c.json(thrift.spendByWho({ from: q(c, 'from') ?? to.slice(0, 8) + '01', to })); });
  r.get('/thrift/shop-groups', (c) => c.json(thrift.shopGroups(q(c, 'list'))));
  r.put('/thrift/shop-overrides', async (c) => { const b = await json(c); return c.json(b.store ? thrift.setShopOverride(String(b.name ?? ''), String(b.store)) : thrift.clearShopOverride(String(b.name ?? ''))); });
  r.put('/gym/next-note', async (c) => { const b = await json(c); return c.json(thrift.setNextNote(String(b.exercise ?? ''), String(b.note ?? ''))); });
  r.get('/gym/carry-forward', (c) => c.json(thrift.gymCarryForward(q(c, 'exercise') ?? '')));
  r.post('/gym/next-note/ack', async (c) => c.json(thrift.ackNextNote(String((await json(c)).exercise ?? ''))));

  // ---------- Habitat ----------
  r.get('/habitat/today', (c) => c.json(habitat.habitatToday(dayQ(c))));
  r.post('/doubles/check', async (c) => { const b = await json(c); return c.json({ double: habitat.possibleDouble(b.kind, b.row ?? b) }); });
  r.post('/doubles/keep-both', async (c) => { const b = await json(c); return c.json(habitat.keepBoth(String(b.id ?? ''), String(b.other_id ?? ''))); });
  r.get('/removed', (c) => c.json(habitat.recentlyRemoved(qn(c, 'days') ?? 14, qn(c, 'limit') ?? 50)));
  r.post('/removed/:table/:id/restore', (c) => c.json(habitat.restoreRemoved(c.req.param('table'), c.req.param('id'))));
  r.get('/last-done', (c) => c.json(habitat.lastDoneBoard(dayQ(c))));
  r.post('/last-done', async (c) => { const b = await json(c); return c.json(habitat.addLastDone(String(b.name ?? ''), b), 201); });
  r.post('/last-done/stamp', async (c) => { const b = await json(c); return c.json(habitat.stampLastDone(String(b.name ?? ''), b.at, b.id)); });
  r.patch('/last-done/:id', async (c) => { const b = await json(c); return c.json(habitat.renameLastDone(c.req.param('id'), String(b.name ?? ''), b.note)); });
  r.delete('/last-done/:id', (c) => c.json(habitat.deleteLastDone(c.req.param('id'))));
  r.get('/free-to-spend', (c) => c.json(habitat.freeToSpend(dayQ(c))));
  r.get('/lent', (c) => c.json(habitat.listLent({ open: q(c, 'all') !== '1', direction: q(c, 'direction') as never })));
  r.post('/lent', async (c) => c.json(habitat.addLent(await json(c) as never), 201));
  r.post('/lent/:id/return', (c) => c.json(habitat.returnLent(c.req.param('id'), q(c, 'at'))));
  r.delete('/lent/:id', (c) => c.json(habitat.deleteLent(c.req.param('id'))));
  r.get('/closed-days', (c) => { const from = q(c, 'from') ?? lifeToday(); return c.json(habitat.closedDays(from, q(c, 'to') ?? from)); });
  r.get('/leave-by', (c) => c.json(habitat.leaveBy(q(c, 'arrive') ?? '', qn(c, 'travel') ?? 0, qn(c, 'buffer') ?? 10)));
  r.get('/gym/workouts/:id/forecast', (c) => c.json(habitat.workoutForecast(c.req.param('id'))));
  r.get('/usual-buys', (c) => c.json(habitat.usualBuys(dayQ(c), qn(c, 'soon') ?? 3)));
  r.get('/helped', (c) => { const s = q(c, 'q'); return c.json(s ? habitat.searchHelped(s, 50) : habitat.listHelped(q(c, 'situation'), 50)); });
  r.get('/helped/top', (c) => c.json(habitat.helpedTop(qn(c, 'n') ?? 10, q(c, 'situation'))));
  r.post('/helped', async (c) => c.json(habitat.addHelped(await json(c) as never), 201));
  r.delete('/helped/:id', (c) => c.json(habitat.deleteHelped(c.req.param('id'))));
  r.get('/experiments', (c) => c.json({ running: habitat.runningExperiment(dayQ(c)), all: habitat.listExperiments(50) }));
  r.post('/experiments', async (c) => c.json(habitat.startExperiment(await json(c) as never), 201));
  r.post('/experiments/:id/end', async (c) => c.json(habitat.endExperiment(c.req.param('id'), String((await json(c)).note ?? ''))));
  r.get('/blocks/swap', (c) => c.json(habitat.swapOptions(dayQ(c), q(c, 'block') ?? '', new Date())));

  // ---------- Screen time ----------
  r.get('/screentime', (c) => c.json(screen.screenTimeSummary(dayQ(c), qn(c, 'days') ?? 1, qn(c, 'top') ?? 10)));
  r.delete('/screentime/devices/:device', (c) => c.json(screen.forgetDevice(c.req.param('device'))));

  // ---------- Grades + goals v2 ----------
  const id = (c: Context) => c.req.param('id') ?? '';
  r.get('/grades/week', (c) => c.json(grades.gradesWeek(q(c, 'week'), dayQ(c))));
  r.get('/grades/history', (c) => c.json(grades.gradesHistory(qn(c, 'weeks') ?? 8, dayQ(c))));
  r.put('/grades/targets', async (c) => { const b = await json(c); return c.json(grades.setGradeTarget(String(b.area), String(b.input), Number(b.target))); });
  r.get('/grades/areas', (c) => c.json(grades.listAreas()));
  r.post('/grades/areas', async (c) => c.json(grades.addArea(await json(c) as never), 201));
  r.patch('/grades/areas/:id', async (c) => c.json(grades.updateArea(id(c), await json(c) as never)));
  r.get('/day-rating', (c) => c.json(grades.getDayRating(dayQ(c))));
  r.put('/day-rating', async (c) => { const b = await json(c); return c.json(grades.setDayRating(Number(b.rating), b.day ?? dayQ(c), String(b.note ?? ''), Array.isArray(b.tags) ? b.tags.map(String) : undefined)); });
  r.get('/day-rating/tags', (c) => c.json(grades.RATING_TAGS));
  r.get('/ratings/patterns', (c) => c.json(grades.ratingPatterns(dayQ(c))));
  r.get('/areas/quiet', (c) => c.json(grades.quietAreas(dayQ(c))));
  r.post('/areas/quiet/:key/dismiss', (c) => c.json(grades.dismissQuiet(c.req.param('key') ?? '', dayQ(c))));
  r.post('/areas/quiet/:key/start', async (c) => { const b = await json(c); return c.json(grades.quietStart(c.req.param('key') ?? '', String(b.option ?? ''), dayQ(c)), 201); });
  r.post('/grades/quarter-export', (c) => c.json(grades.quarterReport(dayQ(c), true)));
  r.get('/grades/quarter', (c) => c.json(grades.quarterReport(dayQ(c), false)));
  r.delete('/day-rating', (c) => c.json(grades.clearDayRating(dayQ(c))));
  r.get('/goals2', (c) => { const d = dayQ(c); grades.ensureConfidenceAsk(d); return c.json(grades.goalsTree(d, q(c, 'status') === 'all' ? 'all' : 'active')); });
  r.get('/goals2/next-up', (c) => c.json(grades.goalNextUp(dayQ(c))));
  r.get('/goals2/next-step', (c) => c.json(grades.goalsNextStep(dayQ(c))));
  r.post('/grades/change', async (c) => { const b = await json(c); return c.json(grades.setWeekChange(b.week ? String(b.week) : undefined, b.text === undefined ? undefined : String(b.text), dayQ(c))); });
  r.get('/done-log', (c) => { const rg = q(c, 'range'); return c.json(grades.doneLog(rg === 'day' || rg === 'month' ? rg : 'week', dayQ(c))); });
  r.get('/goals2/templates', (c) => c.json(grades.GOAL_TEMPLATES));
  r.post('/goals2/from-template', async (c) => { const b = await json(c); return c.json(grades.goalFromTemplate(String(b.key), b as never, dayQ(c)), 201); });
  r.post('/goals2', async (c) => c.json(grades.createGoal(await json(c) as never, dayQ(c)), 201));
  r.get('/goals2/:id', (c) => c.json(grades.goalDetail(id(c), dayQ(c))));
  r.patch('/goals2/:id', async (c) => c.json(grades.updateGoal(id(c), await json(c) as never, dayQ(c))));
  r.delete('/goals2/:id', (c) => c.json(grades.removeGoal(id(c))));
  r.post('/goals2/:id/repace', async (c) => { const b = await json(c); return c.json(grades.repaceGoal(id(c), dayQ(c), b.target_date)); });
  r.post('/goals2/:id/shrink', (c) => c.json(grades.shrinkGoal(id(c), dayQ(c))));
  r.get('/goals2/:id/whatif', (c) => c.json(grades.goalWhatIf(id(c), qn(c, 'per_week') ?? 0, dayQ(c))));
  r.post('/goals2/:id/pause', (c) => c.json(grades.pauseGoal(id(c))));
  r.post('/goals2/:id/resume', (c) => c.json(grades.resumeGoal(id(c), dayQ(c))));
  r.post('/goals2/:id/finish', async (c) => { const b = await json(c); return c.json(grades.finishGoal(id(c), b.status === 'dropped' ? 'dropped' : 'done')); });
  r.post('/goals2/:id/reopen', (c) => c.json(grades.reopenGoal(id(c))));
  r.post('/goals2/:id/milestones', async (c) => { const b = await json(c); return c.json(grades.addMilestone(id(c), String(b.name ?? ''), b.due, b.id), 201); });
  r.post('/goals2/:id/links', async (c) => { const b = await json(c); return c.json(grades.linkGoal(id(c), b.kind, String(b.ref))); });
  r.delete('/goals2/:id/links/:kind/:ref', (c) => c.json(grades.unlinkGoal(id(c), c.req.param('kind') ?? '', c.req.param('ref') ?? '')));
  r.post('/milestones/:id/done', async (c) => { const b = await json(c); return c.json(grades.milestoneDone(id(c), b.done !== false)); });
  r.patch('/milestones/:id', async (c) => c.json(grades.updateMilestone(id(c), await json(c) as never)));
  r.delete('/milestones/:id', (c) => c.json(grades.removeMilestone(id(c))));

  // ---------- Car ----------
  const carQ = (c: Context) => q(c, 'car');
  r.get('/car', (c) => c.json(car.carOverview(carQ(c), dayQ(c))));
  r.get('/car/due', (c) => c.json(car.carDue(carQ(c), dayQ(c))));
  r.get('/car/cars', (c) => c.json(car.listCars(q(c, 'all') !== '0')));
  r.post('/car/cars', async (c) => c.json(car.addCar(await json(c) as never), 201));
  r.patch('/car/cars/:id', async (c) => c.json(car.updateCar(id(c), await json(c) as never)));
  r.delete('/car/cars/:id', (c) => c.json(car.deleteCar(id(c))));
  r.get('/car/km', (c) => c.json(car.listKm(carQ(c), qn(c, 'limit') ?? 50)));
  r.post('/car/km', async (c) => c.json(car.logKm(await json(c) as never), 201));
  r.delete('/car/km/:id', (c) => c.json(car.deleteKm(id(c))));
  r.get('/car/fuel', (c) => c.json(car.listFuel(carQ(c), qn(c, 'limit') ?? 100)));
  r.post('/car/fuel', async (c) => c.json(car.addFuel(await json(c) as never), 201));
  r.delete('/car/fuel/:id', (c) => c.json(car.deleteFuel(id(c))));
  r.get('/car/service', (c) => c.json(car.listService(carQ(c), qn(c, 'limit') ?? 100)));
  r.post('/car/service', async (c) => c.json(car.addService(await json(c) as never), 201));
  r.patch('/car/service/:id', async (c) => c.json(car.updateService(id(c), await json(c) as never)));
  r.delete('/car/service/:id', (c) => c.json(car.deleteService(id(c))));
  r.get('/car/papers', (c) => c.json(car.listPapers(carQ(c), q(c, 'history') === '1')));
  r.post('/car/papers', async (c) => c.json(car.addPaper(await json(c) as never), 201));
  r.patch('/car/papers/:id', async (c) => c.json(car.updatePaper(id(c), await json(c) as never)));
  r.post('/car/papers/:id/renew', async (c) => c.json(car.renewPaper(id(c), await json(c) as never), 201));
  r.delete('/car/papers/:id', (c) => c.json(car.deletePaper(id(c))));
  r.get('/car/listings', (c) => c.json(car.listListings(q(c, 'status'))));
  r.post('/car/listings', async (c) => c.json(car.addListing(await json(c) as never), 201));
  r.patch('/car/listings/:id', async (c) => c.json(car.updateListing(id(c), await json(c) as never)));
  r.delete('/car/listings/:id', (c) => c.json(car.deleteListing(id(c))));

  // ---------- Notifications (push centre) ----------
  r.get('/push/status', (c) => c.json(pc.pushStatus()));
  r.get('/push/prefs', (c) => c.json(pc.pushPrefs()));
  r.put('/push/prefs', async (c) => c.json(pc.updatePushPrefs(await json(c))));
  r.get('/push/log', (c) => c.json(pc.pushLogList(qn(c, 'limit'), q(c, 'cat'))));
  r.get('/push/held', (c) => c.json(pc.heldItems()));
  r.delete('/push/held/:id', (c) => c.json(pc.heldDrop(Number(c.req.param('id')))));
  r.post('/push/held/flush', async (c) => c.json(await pc.heldFlush()));
  r.get('/push/scheduled', (c) => c.json(pc.scheduledItems()));
  r.post('/push/scheduled', async (c) => c.json(pc.scheduleAdd(await json(c)), 201));
  r.delete('/push/scheduled/:id', (c) => c.json(pc.scheduleCancel(Number(c.req.param('id')))));
  r.post('/push/test', async (c) => c.json(await pc.testPush()));

  return r;
};
