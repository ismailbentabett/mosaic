// Phase 2 MCP tools: tasks on SQLite + life modules. Registered from buildMcpServer.
import { z } from 'zod';
import { logAction } from '../log.ts';
import { lifeToday } from '../time.ts';
import * as tasks from './tasks/store.ts';
import * as money from './money/store.ts';
import * as food from './food/store.ts';
import * as gym from './gym/store.ts';
import * as body from './body/store.ts';
import * as profile from './profile/store.ts';
import * as brain from './brain/store.ts';
import { lifeSnapshot } from './life.ts';
import * as x from './extras/store.ts';
import * as screen from './screentime/store.ts';
import * as ideas from './ideas/store.ts';
import * as people from './people/store.ts';
import * as thrift from './thrift/store.ts';
import * as habitat from './habitat/store.ts';
import * as grades from './grades/store.ts';
import * as car from './car/store.ts';
import * as imports from './imports.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reg = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (a: any) => unknown) => unknown;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD life-day (rolls at 04:00). Default today.');
const ref = z.union([z.string(), z.number()]).describe('Task id (uuid)');
const prio = (p?: number) => (p === undefined ? undefined : Math.max(0, Math.min(3, Math.round(p))));
const dueOf = (d?: string | null) => (d === undefined ? undefined : d === null ? null : d.slice(0, 10));

/** tasks_* keep their names and output shape (compat) so existing commands keep working. */
export const registerTaskTools = (reg: Reg, source: string) => {
  reg('tasks_list', 'List tasks. view: today | needs_day | upcoming | inbox | anytime | someday | waiting | done | all. project: name or id.',
    { view: z.enum(tasks.VIEWS as unknown as [string, ...string[]]).default('today'), project: z.union([z.string(), z.number()]).optional(),
      tag: z.string().optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(500).optional() },
    (a) => ({
      projects: tasks.listProjects().map((p) => ({ id: p.id, title: p.name })),
      tasks: tasks.listTasks({ view: a.view, project: a.project === undefined ? undefined : String(a.project), tag: a.tag, q: a.q, limit: a.limit }).map(tasks.compat),
    }));
  reg('tasks_add', 'Add a task. Natural text works: "send invoice fri 3pm #admin !1 ~20m ^Work". project: name (default Inbox = none).',
    { title: z.string().min(1).max(250), project: z.union([z.string(), z.number()]).optional(), due: z.string().optional(),
      description: z.string().max(4000).optional(), priority: z.number().int().min(0).max(5).optional(),
      est_minutes: z.number().int().min(1).max(600).optional(), first_action: z.string().max(200).optional(), done_def: z.string().max(200).optional() },
    (a) => {
      const extra: tasks.TaskInput = { notes: a.description, priority: prio(a.priority), due_date: dueOf(a.due), est_minutes: a.est_minutes,
        first_action: a.first_action, done_def: a.done_def, source };
      if (a.project !== undefined && String(a.project).toLowerCase() !== 'inbox') extra.project = String(a.project);
      const t = tasks.quickAdd(a.title, extra);
      logAction(source, 'tasks_add', `${t.id} ${t.title}`);
      return tasks.compat(t);
    });
  reg('tasks_update', 'Edit a task: title, done, due (null clears), project (move), description, priority, est_minutes.',
    { id: ref, title: z.string().min(1).max(250).optional(), done: z.boolean().optional(), due: z.string().nullable().optional(),
      project: z.union([z.string(), z.number()]).optional(), description: z.string().max(4000).optional(),
      priority: z.number().int().min(0).max(5).optional(), est_minutes: z.number().int().min(1).max(600).nullable().optional() },
    (a) => {
      let t = tasks.updateTask(a.id, { title: a.title, due_date: dueOf(a.due), notes: a.description, priority: prio(a.priority),
        est_minutes: a.est_minutes ?? undefined, project: a.project === undefined ? undefined : String(a.project) });
      if (a.done === true && t.status !== 'done') t = tasks.completeTask(t.id).task;
      if (a.done === false && t.status !== 'open') t = tasks.reopenTask(t.id);
      logAction(source, 'tasks_update', `${t.id} ${t.title}`);
      return tasks.compat(t);
    });
  reg('tasks_done', 'Mark a task done (done=false reopens). Repeating tasks create their next occurrence.',
    { id: ref, done: z.boolean().default(true) }, (a) => {
      if (a.done === false) { const t = tasks.reopenTask(a.id); logAction(source, 'tasks_done', `${t.id} reopened`); return tasks.compat(t); }
      const r = tasks.completeTask(a.id);
      logAction(source, 'tasks_done', `${r.task.id} done`);
      return { ...tasks.compat(r.task), next: r.next ? tasks.compat(r.next) : null };
    });
};

export const registerModuleTools = (reg: Reg, source: string) => {
  // ---------- Life ----------
  reg('life_snapshot', 'One call: today\'s tasks, habits, goals, money week + runway, food, gym, body, open asks. Read this first for personal questions.',
    { date: day }, (a) => lifeSnapshot(a.date ?? lifeToday()));
  reg('profile_get', 'Profile facts the user answered in the app (or proposed). prefix e.g. "body." Never ask these in chat; use asks.',
    { prefix: z.string().max(60).optional() }, (a) => profile.profileGet(a.prefix ?? ''));
  reg('profile_propose', 'Propose a profile fact from evidence. Never overwrites an answer from the user. confidence 0–1.',
    { key: z.string().max(80), value: z.union([z.string(), z.number(), z.boolean()]), confidence: z.number().min(0).max(1).optional() },
    (a) => { const r = profile.profilePropose(a.key, a.value, 'claude', a.confidence ?? 0.6); logAction(source, 'profile_propose', a.key); return r; });
  reg('asks_next', 'Questions the app will ask the user next. To get a missing fact, add an ask (key, question, why, answer_type) instead of asking in chat.',
    { n: z.number().int().min(1).max(20).optional(),
      add: z.object({ key: z.string(), question: z.string().max(200), why: z.string().max(200), answer_type: z.enum(['number', 'choice', 'text', 'yes_no']),
        options: z.array(z.string()).optional(), priority: z.number().int().min(0).max(100).optional() }).optional() },
    (a) => {
      if (a.add) { profile.addAsk({ ...a.add, module: a.add.key.split('.')[0] }); logAction(source, 'asks_add', a.add.key); }
      return profile.asksNext(a.n ?? 5);
    });
  reg('asks_answer', 'Record an answer the user gave inside the app UI (only when they typed it to you explicitly as an answer).',
    { key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) },
    (a) => { const r = profile.asksAnswer(a.key, a.value); logAction(source, 'asks_answer', a.key); return r; });

  // ---------- Goals + habits ----------
  reg('goals_list', 'Goals with progress. status: active | done | dropped | all.',
    { status: z.enum(['active', 'done', 'dropped', 'all']).optional() }, (a) => tasks.listGoals(a.status ?? 'active'));
  reg('habits_list', 'Habits with this week\'s count vs target. No streaks.', { date: day }, (a) => tasks.listHabits(a.date ?? lifeToday()));
  reg('habits_checkin', 'Check in a habit for a day (count, default 1; 0 clears).',
    { habit: z.string(), date: day, count: z.number().int().min(0).max(20).optional() },
    (a) => { const r = tasks.checkHabit(a.habit, a.date ?? lifeToday(), a.count ?? 1); logAction(source, 'habits_checkin', a.habit); return r; });

  // ---------- Money ----------
  reg('money_log', 'Log an expense/income. text "450 coffee" or "+20000 salary" works; or give amount + fields. Personal track unless account says otherwise.',
    { text: z.string().max(200).optional(), amount: z.number().positive().optional(), kind: z.enum(['expense', 'income']).optional(),
      currency: z.string().length(3).optional(), category: z.string().optional(), account: z.string().optional(),
      note: z.string().max(500).optional(), payee: z.string().max(120).optional(), date: day },
    (a) => {
      const extra = { kind: a.kind, currency: a.currency, category: a.category, account: a.account, note: a.note, payee: a.payee, day: a.date };
      const r = a.text ? money.quickLog(a.text, extra) : money.logRecord({ ...extra, amount: a.amount! } as money.RecordInput);
      logAction(source, 'money_log', `${(r as { id: string }).id}`);
      return r;
    });
  reg('money_summary', 'Spend/income by category for week | month | year (personal by default) plus runway in weeks.',
    { period: z.enum(['week', 'month', 'year']).default('month'), date: day, track: z.enum(['personal', 'business']).optional() },
    (a) => ({ summary: money.summary(money.periodOf(a.period ?? 'month', a.date ?? lifeToday()), a.track ?? 'personal'), runway: money.runway() }));
  // Parity with the Money screens: records, budgets, accounts, transfers, rates, savings goals, debts, shopping.
  reg('money_records', 'List money records (newest first). kind filter: expense | income | transfer.',
    { from: day, to: day, account: z.string().optional(), category: z.string().optional(), q: z.string().max(100).optional(),
      kind: z.enum(['expense', 'income', 'transfer']).optional(), limit: z.number().int().min(1).max(500).optional() },
    (a) => money.listRecords({ ...a, limit: a.limit ?? 50 }));
  reg('money_record_edit', 'Edit or delete a record. Changing kind clears a category of the other kind (no accidental refunds). rate_to_usd sets a manual rate.',
    { id: z.string(), delete: z.boolean().optional(), amount: z.number().positive().optional(), kind: z.enum(['expense', 'income']).optional(),
      category: z.string().optional(), note: z.string().max(1000).optional(), payee: z.string().max(120).optional(), date: day,
      labels: z.array(z.string().max(40)).max(20).optional(), rate_to_usd: z.number().positive().optional() },
    (a) => {
      const r = a.delete ? money.deleteRecord(a.id)
        : money.updateRecord(a.id, { amount: a.amount, kind: a.kind, category: a.category, note: a.note, payee: a.payee, day: a.date, labels: a.labels, rate_to_usd: a.rate_to_usd } as never);
      logAction(source, 'money_record_edit', a.id); return r;
    });
  reg('money_budget', 'Budgets. action list | weekly (set the weekly amount that "Free this week" reads) | add | update | delete.',
    { action: z.enum(['list', 'weekly', 'add', 'update', 'delete']), id: z.string().optional(), name: z.string().max(80).optional(),
      period: z.enum(['week', 'month', 'year']).optional(), amount_usd: z.number().positive().optional(), categories: z.array(z.string()).optional() },
    (a) => {
      if (a.action === 'list') return money.listBudgets();
      const r = a.action === 'weekly' ? money.setWeeklyBudget(a.amount_usd ?? 0)
        : a.action === 'add' ? money.addBudget({ name: a.name ?? 'Budget', period: a.period ?? 'week', amount_usd: a.amount_usd ?? 0, categories: a.categories })
          : a.action === 'update' ? money.updateBudget(a.id ?? '', a) : money.deleteBudget(a.id ?? '');
      logAction(source, 'money_budget', a.action); return r;
    });
  reg('money_accounts', 'Accounts with balances. action list | add | update (rename, archive, opening balance). Never store account numbers.',
    { action: z.enum(['list', 'add', 'update']), id: z.string().optional(), name: z.string().max(80).optional(), type: z.string().max(20).optional(),
      currency: z.string().length(3).optional(), track: z.enum(['personal', 'business']).optional(), opening_balance: z.number().optional(), archived: z.boolean().optional() },
    (a) => {
      if (a.action === 'list') return money.listAccounts().map((x) => ({ ...x, balance: money.balance(String(x.id)) }));
      const r = a.action === 'add' ? money.addAccount({ name: a.name ?? '', type: a.type, currency: a.currency, track: a.track, opening_balance: a.opening_balance })
        : money.updateAccount(a.id ?? '', { name: a.name, archived: a.archived, opening_balance: a.opening_balance, track: a.track });
      logAction(source, 'money_accounts', a.action); return r;
    });
  reg('money_transfer', 'Move money between two accounts (not spend). to_amount when the currencies differ.',
    { from: z.string(), to: z.string(), amount: z.number().positive(), to_amount: z.number().positive().optional(), note: z.string().max(300).optional(), date: day },
    (a) => { const r = money.transfer({ from: a.from, to: a.to, amount: a.amount, to_amount: a.to_amount, note: a.note, day: a.date }); logAction(source, 'money_transfer', `${a.from}→${a.to}`); return r; });
  reg('money_rate', 'Exchange rates. No args lists them. Set one with currency + to_usd.',
    { currency: z.string().length(3).optional(), to_usd: z.number().positive().optional(), date: day },
    (a) => {
      if (a.currency && a.to_usd) { const r = money.setRate(a.currency, a.to_usd, a.date ?? lifeToday()); logAction(source, 'money_rate', a.currency); return r; }
      return money.listRates();
    });
  reg('money_savings', 'Savings goals (car fund). action list | add | update | delete. Saved = the linked account balance.',
    { action: z.enum(['list', 'add', 'update', 'delete']), id: z.string().optional(), name: z.string().max(80).optional(), target_usd: z.number().positive().optional(),
      target_date: day, account: z.string().optional() },
    (a) => {
      if (a.action === 'list') return money.listSavingsGoals();
      const r = a.action === 'add' ? money.addSavingsGoal({ name: a.name ?? '', target_usd: a.target_usd ?? 0, target_date: a.target_date, account: a.account })
        : a.action === 'update' ? money.updateSavingsGoal(a.id ?? '', a) : money.deleteSavingsGoal(a.id ?? '');
      logAction(source, 'money_savings', a.action); return r;
    });
  reg('money_debts', 'Money lent or borrowed. action list | add | repay (amount in the debt currency; lands on an account).',
    { action: z.enum(['list', 'add', 'repay']), id: z.string().optional(), person: z.string().max(80).optional(), direction: z.enum(['lent', 'borrowed']).optional(),
      amount: z.number().positive().optional(), currency: z.string().length(3).optional(), account: z.string().optional(), note: z.string().max(500).optional(), record: z.boolean().optional() },
    (a) => {
      if (a.action === 'list') return money.listDebts();
      const r = a.action === 'add' ? money.addDebt({ person: a.person ?? '', direction: a.direction ?? 'lent', amount: a.amount ?? 0, currency: a.currency, account: a.account, note: a.note, record: a.record })
        : money.repayDebt(a.id ?? '', a.amount ?? 0, a.account);
      logAction(source, 'money_debts', a.action); return r;
    });
  reg('shopping', 'Shopping list. action list | add | tick | untick | clear_done.',
    { action: z.enum(['list', 'add', 'tick', 'untick', 'clear_done']), id: z.string().optional(), name: z.string().max(120).optional(), list: z.string().max(40).optional(), qty: z.string().max(20).optional() },
    (a) => {
      if (a.action === 'list') return money.listShopping(a.list, true);
      if (a.action === 'add') return money.addShopping(a.name ?? '', a.list, a.qty);
      if (a.action === 'clear_done') return { cleared: money.clearDoneShopping(a.list) };
      return money.toggleShopping(a.id ?? '', a.action === 'tick');
    });

  // ---------- Imports ----------
  reg('import_csv', 'Import a CSV export from another app. todoist = one project export (tasks, sections, subtasks, @labels); ynab = Register.csv (transactions, transfers skipped); mfp = MyFitnessPal nutrition export. Idempotent: re-importing skips rows already in. Use dry_run first to see counts.',
    { source: z.enum(['todoist', 'ynab', 'mfp']), csv: z.string().min(1).max(5_000_000), project: z.string().max(80).optional().describe('todoist only. Default Inbox'),
      currency: z.string().length(3).optional().describe('ynab only: currency for new accounts. Default USD'), dry_run: z.boolean().optional() },
    (a) => {
      const r = a.source === 'mfp' ? food.importMfp(a.csv, !!a.dry_run) : imports.importCsv(a.source, a.csv, { project: a.project, currency: a.currency, dryRun: a.dry_run });
      if (!a.dry_run) logAction(source, 'import_csv', a.source);
      return r;
    });

  // ---------- Food ----------
  reg('food_search', 'Search the local food database (own foods first). kcal/macros per 100 g.',
    { q: z.string().min(1).max(100), limit: z.number().int().min(1).max(50).optional() }, (a) => food.searchFoods(a.q, a.limit ?? 10));
  reg('food_log', 'Log food: food (id or name) + grams, or name + kcal (+macros) as an estimate. Slot from time if omitted.',
    { food: z.string().optional(), grams: z.number().positive().max(5000).optional(), recipe: z.string().optional(), portions: z.number().positive().optional(),
      name: z.string().max(120).optional(), kcal: z.number().min(0).max(10000).optional(), protein: z.number().min(0).optional(),
      carbs: z.number().min(0).optional(), fat: z.number().min(0).optional(), slot: z.string().optional(), date: day, estimate: z.boolean().optional() },
    (a) => { const r = food.logFood({ ...a, day: a.date }); logAction(source, 'food_log', String((r as { id?: string }).id ?? '')); return r; });
  reg('food_day', 'Food diary for a day: entries by slot, totals, estimated target, water.', { date: day }, (a) => food.foodDay(a.date ?? lifeToday()));
  reg('food_day_status', 'Mark a food day complete (all eaten food logged), partial or blank; null clears. Only complete days feed the maintenance estimate.',
    { status: z.enum(['complete', 'partial', 'blank']).nullable(), date: day },
    (a) => { const r = food.setDayStatus(a.date ?? lifeToday(), a.status); logAction(source, 'food_day_status', `${r.day}:${r.status}`); return r; });
  reg('food_tdee', 'Maintenance estimate from the last 21 days (complete days + trend weight) and a suggested target for a goal rate. Estimates, not medical advice.',
    { rate: z.number().min(-1).max(0.5).optional().describe('kg/week, negative = lose. Default 0'), protein_per_kg: z.number().min(0.8).max(3).optional(), date: day },
    (a) => ({ adaptive: food.adaptiveTdee(a.date ?? lifeToday()), suggestion: food.suggestTarget(a.rate ?? 0, a.protein_per_kg ?? 1.8, a.date ?? lifeToday()) }));

  // ---------- Gym ----------
  reg('gym_routines', 'Routines with their exercises, plus the active workout if one is running.', {},
    () => ({ routines: gym.listRoutines(), active: gym.activeWorkout() }));
  reg('gym_last', 'Last performance of an exercise and the next-session suggestion. deload = lighter week (about 90%).',
    { exercise: z.string(), rep_min: z.number().int().min(1).max(50).optional(), rep_max: z.number().int().min(1).max(50).optional(), deload: z.boolean().optional() },
    (a) => ({ last: gym.lastPerformance(a.exercise), next: gym.suggestNext(a.exercise, a.rep_min ?? 8, a.rep_max ?? 12, a.deload ?? false) }));
  reg('gym_volume', 'Working sets per muscle for the week starting Monday `week` (secondary muscles count half).',
    { week: day }, (a) => gym.muscleVolume(a.week ?? lifeToday()));
  reg('gym_log_workout', 'Log a finished workout in one call (e.g. from a voice note). Sets: exercise, weight kg, reps, type.',
    { name: z.string().max(80).optional(), routine: z.string().optional(), started_at: z.string().optional(), ended_at: z.string().optional(),
      sets: z.array(z.object({ exercise: z.string(), weight: z.number().min(0).optional(), reps: z.number().int().min(0).optional(),
        seconds: z.number().min(0).optional(), distance: z.number().min(0).optional(), type: z.string().optional(), rpe: z.number().optional() })).min(1).max(200),
      notes: z.string().max(1000).optional() },
    (a) => {
      const w = gym.startWorkout({ routine: a.routine, name: a.name, at: a.started_at });
      const prs: unknown[] = [];
      for (const s of a.sets) prs.push(...gym.logSet({ ...s, workout_id: w.id, rest_s: 0 }).prs);
      const done = gym.finishWorkout(w.id, a.notes, a.ended_at ? new Date(a.ended_at) : new Date());
      logAction(source, 'gym_log_workout', w.id);
      return { workout: done, prs };
    });

  // ---------- Body ----------
  reg('body_log', 'Log a body metric: weight (kg), waist (cm), body_fat (%) … Estimates only, never medical.',
    { kind: z.string(), value: z.number(), unit: z.string().optional(), date: day },
    (a) => { const r = body.logMetric({ kind: a.kind, value: a.value, unit: a.unit, day: a.date }); logAction(source, 'body_log', a.kind); return r; });
  reg('body_summary', 'Weight trend (smoothed), last values, weekly change.', { date: day }, (a) => body.bodySummary(a.date ?? lifeToday()));

  // ---------- Brain ----------
  reg('brain_search', 'One search across vault notes, tasks, foods, personal money records and workouts.',
    { q: z.string().min(1).max(200), kinds: z.array(z.enum(['note', 'task', 'food', 'record', 'workout'])).optional(), limit: z.number().int().min(1).max(50).optional() },
    (a) => brain.brainSearch(a.q, { kinds: a.kinds, limit: a.limit }));

  // ---------- Backlog extras ----------
  reg('done_list', 'What got done (tasks, focus, sets, food, money, habits, cards). No scoring.',
    { from: day, to: day }, (a) => { const f = a.from ?? lifeToday(); return x.doneList(f, a.to ?? f); });
  reg('rescue', 'Bad-day rescue: Zero mode for today (block titles stripped, pushes silenced), returns the bad-day menu and one 10-minute next task. Ends at the next 04:00. end=true stops it now; keep=true keeps Zero past 04:00.',
    { end: z.boolean().optional(), keep: z.boolean().optional() }, async (a) => {
      const r = a.end ? await x.endRescue() : a.keep ? x.keepRescue() : await x.rescue();
      logAction(source, 'rescue', a.end ? 'end' : a.keep ? 'keep' : 'start');
      return r;
    });
  reg('documents_list', 'Document register: passport, ID, licence, car papers. Names and end dates only, never ID numbers. Ended ones are listed too. Filter by car id or tag.',
    { car: z.string().optional(), tag: z.string().max(24).optional() }, (a) => x.listDocuments(lifeToday(), { car_id: a.car, tag: a.tag }));
  reg('documents_add', 'Add a document to the register. Reminders at 60, 30, 7 and 0 days before the end date and once after. Never store ID numbers: write "see password manager".',
    { name: z.string().min(1).max(80), expires_on: day, where_kept: z.string().max(120).optional(), note: z.string().max(300).optional(),
      tags: z.array(z.string().max(24)).max(8).optional() },
    (a) => { const r = x.addDocument(a); logAction(source, 'documents_add', a.name); return r; });
  reg('documents_update', 'Change a document (new end date resets its reminders).',
    { id: z.string(), name: z.string().min(1).max(80).optional(), expires_on: day.nullable(), where_kept: z.string().max(120).optional(), note: z.string().max(300).optional(),
      tags: z.array(z.string().max(24)).max(8).optional() },
    (a) => { const { id, ...f } = a; const r = x.updateDocument(id, f); logAction(source, 'documents_update', r.name as string); return r; });
  reg('documents_delete', 'Remove a document from the register (soft delete).', { id: z.string() },
    (a) => { const r = x.deleteDocument(a.id); logAction(source, 'documents_delete', a.id); return r; });
  reg('afford', '"Can I afford it?": runway impact of a one-off spend. Not financial advice.',
    { amount: z.number().positive(), currency: z.string().default('USD'), from: z.string().max(80).optional().describe('Savings goal or its account (e.g. "car") when paid from it. Default: living cash.') }, (a) => x.afford(a.amount, a.currency, undefined, a.from));
  reg('cards_add', 'Add a flashcard (FSRS scheduled).',
    { front: z.string().min(1).max(200), back: z.string().min(1).max(400), deck: z.string().max(40).optional(), gender: z.string().max(10).optional(), example: z.string().max(400).optional() },
    (a) => { const r = x.addCard(a); logAction(source, 'cards_add', a.front); return r; });
  reg('cards_queue', 'Due flashcards now (FSRS) + counts.', { limit: z.number().int().min(1).max(100).optional() }, (a) => x.cardQueue(a.limit ?? 20));
  reg('screentime_summary', 'Screen time from Android, Windows and the browser (ActivityWatch sync). Neutral counts only.',
    { date: day, days: z.number().int().min(1).max(90).optional() }, (a) => screen.screenTimeSummary(a.date ?? lifeToday(), a.days ?? 1));
  reg('questions_open', 'Curiosity queue: up to 5 oldest open personal questions the user parked. Answer each with questions_answer (short, Markdown). Business questions never land here.',
    { limit: z.number().int().min(1).max(5).optional() }, (a) => ideas.openQuestions(a.limit ?? 5));
  reg('questions_answer', 'Answer one parked question. The answer is stored and appended to the vault Log of today.',
    { id: z.string().min(1), answer_md: z.string().min(1).max(4000) },
    async (a) => { const r = await ideas.answerQuestion(a.id, a.answer_md); logAction(source, 'questions_answer', r.text); return r; });
  reg('tasks_fits', 'Tasks with an estimate that fit before the next anchor (meal or sleep). Empty in Zero/Family mode and on Saturday.',
    {}, () => ideas.fits());
  reg('inbox_triage', 'The 5 oldest Inbox items, for a one-decision-each triage.', {}, () => ideas.triage());
  // ---------- People ----------
  reg('promises_list', 'Promises made to people. status: open | kept | released | all.',
    { status: z.enum(['open', 'kept', 'released', 'all']).optional(), limit: z.number().int().min(1).max(200).optional() },
    (a) => people.listPromises(a.status ?? 'open', a.limit ?? 50));
  reg('promises_add', 'Record a promise made to someone (who, what, optional due day).',
    { who: z.string().min(1).max(80), what: z.string().min(1).max(200), due: day, source: z.string().max(40).optional() },
    (a) => { const r = people.addPromise({ ...a, source: a.source ?? source }); logAction(source, 'promises_add', `${a.who}: ${a.what}`); return r; });
  reg('promises_keep', 'Mark a promise kept.', { id: z.string().min(1) }, (a) => { const r = people.keepPromise(a.id); logAction(source, 'promises_keep', a.id); return r; });
  reg('people_due', 'People due a check-in (cadence), plus occasions and promises in the next 14 days. Personal only. Saturday is quiet unless screen=true (the People screen still lists).',
    { date: day, screen: z.boolean().optional() },
    (a) => ({ people: people.peopleDue(a.date ?? undefined, !!a.screen), occasions: people.occasionsSoon(a.date ?? undefined, 14), promises: people.promisesSoon(a.date ?? undefined, !!a.screen) }));
  reg('people_save', 'Add a person (family or friend) or update one by id/name. phone enables call and WhatsApp buttons.',
    { ref: z.string().optional().describe('id or exact name to update; omit to add'), name: z.string().min(1).max(80).optional(),
      relation: z.enum(['family', 'friend', 'other']).optional(), birthday: z.string().optional().describe('MM-DD or YYYY-MM-DD'),
      cadence_days: z.number().int().min(1).max(3650).nullable().optional(), phone: z.string().max(30).nullable().optional(), note: z.string().max(500).optional() },
    (a) => {
      const { ref, ...f } = a;
      const r = ref ? people.updatePerson(ref, f) : people.addPerson({ ...f, name: f.name ?? '' });
      logAction(source, 'people_save', r.name); return r;
    });
  reg('occasions_add', 'Add a yearly occasion (birthday, anniversary, other). md = MM-DD, or date = YYYY-MM-DD.',
    { name: z.string().min(1).max(120), kind: z.enum(['birthday', 'anniversary', 'other']).optional(),
      md: z.string().regex(/^\d{2}-\d{2}$/).optional(), date: day,
      lead_days: z.number().int().min(0).max(90).optional(), note: z.string().max(300).optional() },
    (a) => { const r = people.addOccasion(a); logAction(source, 'occasions_add', a.name); return r; });
  reg('people_touch', 'Log a contact with a person (call, visit, message).',
    { person: z.string().min(1), note: z.string().max(300).optional(), date: day },
    (a) => { const r = people.touch(a.person, a.date ?? undefined, a.note ?? ''); logAction(source, 'people_touch', a.person); return r; });
  reg('waiting_due', 'Waiting-for tasks whose check-on day has come.', { date: day }, (a) => people.waitingDue(a.date ?? undefined));
  reg('capsules_write', 'Write a note to future self that opens on a day (or in N days).',
    { body: z.string().min(1).max(4000), title: z.string().max(120).optional(), open_on: day, in_days: z.number().int().min(1).max(3650).optional() },
    (a) => { const r = people.writeCapsule(a); logAction(source, 'capsules_write', a.title ?? 'capsule'); return r; });
  reg('week_facts', 'Neutral facts for a week (counts only, no scores). week: Monday YYYY-MM-DD.', { week: day }, (a) => people.weekFacts(a.week ?? undefined));

  // ---------- Thrift ----------
  reg('recurring_costs', 'Recurring costs found in money records. Only Claude is allowed as a recurring cost; anything else is flagged for review.',
    { from: day, to: day }, (a) => thrift.recurringCosts({ from: a.from ?? undefined, to: a.to ?? undefined }));
  reg('skipped_buy', 'Log a purchase the user chose not to make (money kept). Neutral.',
    { name: z.string().max(120).optional(), amount: z.number().positive().optional(), currency: z.string().max(3).optional(), note: z.string().max(200).optional(), date: day },
    (a) => { const r = thrift.logSkippedBuy({ ...a, day: a.date ?? undefined }); logAction(source, 'skipped_buy', a.name ?? String(a.amount)); return r; });
  reg('spend_by_who', 'Personal spend split by who it was for (self, family, gifts). Totals only.',
    { from: day, to: day }, (a) => { const to = a.to ?? lifeToday(); return thrift.spendByWho({ from: a.from ?? to.slice(0, 8) + '01', to }); });
  reg('money_record_for', 'Read or set who a personal expense was for (self, family, gift, or a name). Omit who to read; who "" clears it.',
    { id: z.string().min(1), who: z.string().max(40).optional() },
    (a) => {
      if (a.who === undefined) return { record_id: a.id, who: thrift.getRecordFor(a.id) };
      const r = a.who ? thrift.setRecordFor(a.id, a.who) : thrift.clearRecordFor(a.id);
      logAction(source, 'money_record_for', a.id);
      return r;
    });
  reg('recipe_to_shopping', 'Turn a recipe into shopping list items for N portions, skipping what is already listed.',
    { recipe: z.string().min(1), portions: z.number().positive().max(100), list: z.string().max(40).optional() },
    (a) => { const r = thrift.recipeToShopping(a.recipe, a.portions, { list: a.list }); logAction(source, 'recipe_to_shopping', a.recipe); return r; });
  reg('shop_groups', 'Shopping list grouped by shop, in walking order.', { list: z.string().max(40).optional() }, (a) => thrift.shopGroups(a.list));
  reg('gym_next_note', 'Leave a note for next time on an exercise (e.g. "try 65 kg").',
    { exercise: z.string().min(1), note: z.string().min(1).max(200) },
    (a) => { const r = thrift.setNextNote(a.exercise, a.note); logAction(source, 'gym_next_note', a.exercise); return r; });

  // ---------- Habitat ----------
  reg('habitat_today', 'Home card facts: free to spend, usual buys due, running experiment, things lent out.', { date: day }, (a) => habitat.habitatToday(a.date ?? lifeToday()));
  reg('free_to_spend', 'Free to spend this week after planned bills and the car fund. Estimate, not financial advice.', { date: day }, (a) => habitat.freeToSpend(a.date ?? lifeToday()));
  reg('last_done', 'Last-done board: when each recurring chore was last done (no due dates, no nags).', { date: day }, (a) => habitat.lastDoneBoard(a.date ?? lifeToday()));
  reg('last_done_stamp', 'Stamp a chore as done now (creates it if new).', { name: z.string().min(1).max(80) },
    (a) => { const r = habitat.stampLastDone(a.name); logAction(source, 'last_done_stamp', a.name); return r; });
  reg('lent_list', 'Things lent out or borrowed, still open.', { direction: z.enum(['lent', 'borrowed']).optional() }, (a) => habitat.listLent({ open: true, direction: a.direction }));
  reg('lent_add', 'Record a thing lent to or borrowed from someone (objects, not money; money debts live in money).',
    { thing: z.string().min(1).max(120), person: z.string().min(1).max(80), direction: z.enum(['lent', 'borrowed']), back_by: day, note: z.string().max(200).optional() },
    (a) => { const r = habitat.addLent(a); logAction(source, 'lent_add', `${a.thing} (${a.person})`); return r; });
  reg('helped_add', 'Record what helped in a situation (e.g. stuck: walk 10 min). Searchable later.',
    { situation: z.string().min(1).max(80), thing: z.string().min(1).max(200), note: z.string().max(300).optional() },
    (a) => { const r = habitat.addHelped(a); logAction(source, 'helped_add', `${a.situation}: ${a.thing}`); return r; });
  reg('helped_search', 'Search what helped before. Empty q = top items.', { q: z.string().max(100).optional(), situation: z.string().max(80).optional() },
    (a) => (a.q ? habitat.searchHelped(a.q, 20) : habitat.helpedTop(10, a.situation)));
  reg('experiment_start', 'Start a small personal experiment (e.g. no phone before breakfast, 14 days). One runs at a time.',
    { name: z.string().min(1).max(120), hypothesis: z.string().max(300).optional(), days: z.number().int().min(1).max(90).optional() },
    (a) => { const r = habitat.startExperiment(a); logAction(source, 'experiment_start', a.name); return r; });
  reg('closed_days', 'Days shops and offices are likely closed (Friday, Saturday, known holidays). Approximate.',
    { from: day, to: day }, (a) => { const from = a.from ?? lifeToday(); return habitat.closedDays(from, a.to ?? from); });
  reg('swap_options', 'Other tasks that fit a block today, for a one-tap swap. Never edits the calendar.',
    { date: day, block: z.string().min(1).max(60) }, (a) => habitat.swapOptions(a.date ?? lifeToday(), a.block, new Date()));
  reg('removed_recent', 'Recently removed rows (undo shelf, 14 days).', { days: z.number().int().min(1).max(30).optional() }, (a) => habitat.recentlyRemoved(a.days ?? 14, 50));
  reg('grades_week', 'Week review: per-area raw counts vs usual, 3 plain facts (facts[]) and one suggested change for next week (change). No letters to show; overall.letter is legacy. Saturday never counted. week = any day in the week.',
    { week: day }, (a) => grades.gradesWeek(a.week));
  reg('grades_history', 'Legacy per-week snapshots (internal letters) for the last N weeks. Do not show letters; use grades_week facts.', { weeks: z.number().int().min(1).max(52).optional() }, (a) => grades.gradesHistory(a.weeks ?? 8));
  reg('day_rate', 'Rate a day 1-5 with an optional note and tags (launch_used, gym, late_start, family_event, power_cut, outside).', { rating: z.number().int().min(1).max(5), date: day, note: z.string().max(300).optional(), tags: z.array(z.enum(grades.RATING_TAGS)).optional() },
    (a) => { const r = grades.setDayRating(a.rating, a.date ?? lifeToday(), a.note ?? '', a.tags); logAction(source, 'day_rate', String(a.rating)); return r; });
  reg('goals_tree', 'Goals grouped by life area with raw numbers, pace text, next step, milestones. Ignore the legacy letter field.', { status: z.enum(['active', 'all']).optional() },
    (a) => grades.goalsTree(lifeToday(), a.status ?? 'active'));
  reg('goal_create', 'Create a goal. auto: savings:<name> | body:weight | cards:reviewed | gym:workouts | habit:<ref> | project:<ref> | milestones.',
    { name: z.string().min(1).max(120), why: z.string().max(400).optional(), area: z.string().max(60).optional(), target_value: z.number().optional(),
      unit: z.string().max(20).optional(), target_date: day, auto: z.string().max(80).optional(), horizon: z.enum(['quarter', 'year', 'life']).optional(),
      next_step: z.string().max(160).optional(), outcome: z.boolean().optional(), seed_key: z.string().max(60).optional() },
    (a) => { const r = grades.createGoal(a as never); logAction(source, 'goal_create', a.name); return r; });
  reg('goal_update', 'Edit a goal (name, why, target, date, next step), or action: repace | pause | resume | done | dropped | reopen.',
    { goal: z.string().min(1), action: z.enum(['repace', 'pause', 'resume', 'done', 'dropped', 'reopen']).optional(), name: z.string().max(120).optional(),
      why: z.string().max(400).optional(), target_value: z.number().optional(), target_date: day, next_step: z.string().max(160).optional(),
      floor_value: z.number().nullable().optional(), stretch_value: z.number().nullable().optional() },
    (a) => {
      const { goal, action, ...f } = a;
      const r = action === 'repace' ? grades.repaceGoal(goal, lifeToday(), f.target_date) : action === 'pause' ? grades.pauseGoal(goal)
        : action === 'resume' ? grades.resumeGoal(goal) : action === 'done' || action === 'dropped' ? grades.finishGoal(goal, action)
        : action === 'reopen' ? grades.reopenGoal(goal) : grades.updateGoal(goal, f as never);
      logAction(source, 'goal_update', `${goal} ${action ?? 'edit'}`); return r;
    });
  reg('goal_milestone_add', 'Add a milestone to a goal.', { goal: z.string().min(1), name: z.string().min(1).max(160), due: day },
    (a) => { const r = grades.addMilestone(a.goal, a.name, a.due); logAction(source, 'goal_milestone_add', a.name); return r; });
  reg('goal_milestone_done', 'Tick (or untick) a milestone by id.', { id: z.string().min(1), done: z.boolean().optional() },
    (a) => { const r = grades.milestoneDone(a.id, a.done ?? true); logAction(source, 'goal_milestone_done', a.id); return r; });
  reg('goal_link', 'Link a habit or project to a goal.', { goal: z.string().min(1), kind: z.enum(['habit', 'project']), ref: z.string().min(1) },
    (a) => { const r = grades.linkGoal(a.goal, a.kind, a.ref); logAction(source, 'goal_link', `${a.goal} ${a.kind}`); return r; });
  reg('goal_from_template', 'Create a goal from a template: car_fund | weight | cards | gym | read_books | run_10k | side_project.',
    { key: z.string().min(1), target_date: day, target_value: z.number().optional() },
    (a) => { const r = grades.goalFromTemplate(a.key, { target_date: a.target_date, target_value: a.target_value } as never); logAction(source, 'goal_from_template', a.key); return r; });
reg('grades_quarter', 'Write the quarter review to vault Reviews/YYYY-Qn.md (3 facts per week, milestones, goal start/end).', { write: z.boolean().optional() },    (a) => { const r = grades.quarterReport(lifeToday(), a.write !== false); logAction(source, 'grades_quarter', r.path); return r; });  reg('ratings_patterns', 'What shows up on 4-5 vs 1-2 rated days (needs 40 ratings). Shares only, not causes.', {}, () => grades.ratingPatterns());  reg('goals_whatif', 'Savings goal what-if: USD per week -> ETA and runway, capped to keep the cash floor.', { goal: z.string().min(1), per_week_usd: z.number().positive() },    (a) => grades.goalWhatIf(a.goal, a.per_week_usd));  reg('goal_shrink', 'Shrink a goal to its floor target (the floor becomes the target).', { goal: z.string().min(1) },    (a) => { const r = grades.shrinkGoal(a.goal); logAction(source, 'goal_shrink', a.goal); return r; });  reg('areas_quiet', 'Life areas with little logged for 3 finished weeks, with 3 small starts each. Empty outside Normal mode.', {}, () => grades.quietAreas());
  reg('grades_change_set', 'Accept (text omitted) or edit the one suggested change for a week. week = any day in the week.',
    { week: day, text: z.string().min(1).max(160).optional() },
    (a) => { const r = grades.setWeekChange(a.week, a.text); logAction(source, 'grades_change_set', a.text ?? 'accept'); return r; });
  reg('done_log', 'Done-log: one line per thing done ("Tue · Read 20 pages (Personal)") plus month totals (tasks, gym, food days, habits, cards, money saved).',
    { range: z.enum(['day', 'week', 'month']).optional(), date: day }, (a) => grades.doneLog(a.range ?? 'week', a.date ?? lifeToday()));
  reg('goals_next_step', 'Per life area: next milestone of the top active goal as one verb-first task under 45 chars, plus avoid_window (hardest time). For Learning and buffer blocks.',
    { date: day }, (a) => grades.goalsNextStep(a.date ?? lifeToday()));
  // ---------- Car ----------
  const carRef = z.string().max(80).optional().describe('Car name or id. Default: the main car.');
  const cur = z.string().regex(/^[A-Za-z]{3}$/).optional().describe('Currency code. Default: the car currency.');
  const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const moneyOpts = {
    account: z.string().max(80).optional().describe('Money account name or id. Default: the first personal account in that currency.'),
    log_money: z.boolean().optional().describe('false = do not add the amount to money.'),
  };
  const carFields = {
    name: z.string().max(60).optional(), make: z.string().max(40).optional(), model: z.string().max(40).optional(),
    year: z.number().int().optional(), plate: z.string().max(20).optional(),
    fuel: z.string().optional().describe('petrol | diesel | gpl | hybrid | electric'), tank_l: z.number().positive().optional(),
    status: z.string().optional().describe('owned | wanted | sold'), bought_on: day, bought_price: z.number().positive().optional(),
    currency: cur, start_km: z.number().int().nonnegative().optional(), note: z.string().max(1000).optional(),
    is_default: z.boolean().optional().describe('true = this is the main car.'),
  };
  reg('car_overview', 'Car: km, km a month, fuel use (L/100 km), spend this month and over 90 days, cost per km, what is due (service + papers), the car fund and watched listings.',
    { car: carRef, date: day }, (a) => {
      const d = a.date ?? lifeToday();
      return { text: car.overviewText(a.car, d), data: car.carOverview(a.car, d) };
    });
  reg('car_add', 'Save a car. The first car becomes the main car.', carFields,
    (a) => { const r = car.addCar(a as never); logAction(source, 'car_add', String(r.name)); return r; });
  reg('car_update', 'Edit a car (any field from car_add).', { car: z.string().min(1), ...carFields },
    (a) => { const { car: ref, ...f } = a; const r = car.updateCar(ref, f as never); logAction(source, 'car_update', ref); return r; });
  reg('car_fuel_log', 'Log a fuel fill. Give litres or amount (or one of them plus price_per_l). km = odometer at the fill. full false = not filled to the top. The amount also goes to money (Transport > Fuel).',
    { car: carRef, date: day, km: z.number().int().nonnegative().optional(), litres: z.number().positive().optional(),
      amount: z.number().positive().optional(), price_per_l: z.number().positive().optional(), currency: cur,
      full: z.boolean().optional(), station: z.string().max(80).optional(), note: z.string().max(300).optional(), ...moneyOpts },
    (a) => { const { date, ...f } = a; const r = car.addFuel({ ...f, day: date } as never); logAction(source, 'car_fuel_log', String(r.id)); return r; });
  reg('car_service_log', 'Log a service or repair. kind: oil | filters | tyres | brakes | battery | timing_belt | inspection | wash | repair | other. Next due is filled from the usual gaps unless next_km or next_day is given. The amount goes to money (Transport > Car maintenance).',
    { car: carRef, date: day, kind: z.string().optional(), title: z.string().max(80).optional(), km: z.number().int().nonnegative().optional(),
      amount: z.number().positive().optional(), currency: cur, garage: z.string().max(80).optional(), note: z.string().max(1000).optional(),
      next_km: z.number().int().nullable().optional(), next_day: ymd.nullable().optional(), ...moneyOpts },
    (a) => { const { date, ...f } = a; const r = car.addService({ ...f, day: date } as never); logAction(source, 'car_service_log', String(r.title)); return r; });
  reg('car_km_log', 'Log the odometer reading in km.',
    { car: carRef, date: day, km: z.number().int().nonnegative(), note: z.string().max(300).optional() },
    (a) => { const r = car.logKm({ car: a.car, day: a.date, km: a.km, note: a.note }); logAction(source, 'car_km_log', String(a.km)); return r; });
  reg('car_papers_add', 'Save a car paper with its end date (it goes to the documents register, tag car). kind: insurance | registration | technical | vignette | licence | other. where_kept = where the paper is kept (never document numbers). The amount goes to money (Transport > Car papers).',
    { car: carRef, kind: z.string().optional(), name: z.string().max(80).optional(), expires_on: day, amount: z.number().positive().optional(),
      currency: cur, paid_on: day, where_kept: z.string().max(120).optional(), note: z.string().max(1000).optional(), ...moneyOpts },
    (a) => { const r = car.addPaper(a as never); logAction(source, 'car_papers_add', String(r.name)); return r; });
  reg('car_papers_renew', 'Renew a car paper: the old one stays as history, the new end date (and amount) is saved.',
    { id: z.string().min(1), expires_on: ymd, amount: z.number().positive().optional(), currency: cur, paid_on: day, ...moneyOpts },
    (a) => { const { id, ...f } = a; const r = car.renewPaper(id, f); logAction(source, 'car_papers_renew', id); return r; });
  reg('car_due', 'What the car needs next: service by km or date, papers by end date. state: due | soon (30 days or 1,000 km) | later.',
    { car: carRef, date: day }, (a) => car.carDue(a.car, a.date ?? lifeToday()));
  reg('car_listing_add', 'Save a car listing to watch while buying the next car. status: watching | contacted | seen | rejected | bought.',
    { title: z.string().min(1).max(120), year: z.number().int().optional(), km: z.number().int().nonnegative().optional(),
      price: z.number().positive().optional(), currency: cur, url: z.string().max(500).optional(), place: z.string().max(80).optional(),
      status: z.string().optional(), note: z.string().max(1000).optional() },
    (a) => { const r = car.addListing(a); logAction(source, 'car_listing_add', a.title); return r; });
  reg('car_listing_update', 'Update a watched listing (status, price, km, note).',
    { id: z.string().min(1), status: z.string().optional(), price: z.number().positive().optional(),
      km: z.number().int().nonnegative().optional(), note: z.string().max(1000).optional() },
    (a) => { const { id, ...f } = a; const r = car.updateListing(id, f); logAction(source, 'car_listing_update', id); return r; });
};
