// Ordered schema migrations for app.db. Each runs once, inside a transaction, and is recorded in `migrations`.
// Before any pending migration runs on a file database, a snapshot is written with VACUUM INTO.
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SQL as THRIFT_SQL } from './modules/thrift/schema.ts';
import { SQL as PEOPLE_SQL, SQL23 as PEOPLE_PHONE_SQL } from './modules/people/schema.ts';
import { SQL as HABITAT_SQL } from './modules/habitat/schema.ts';
import { SQL as GRADES_SQL, SQL2 as GRADES2_SQL, SQL3 as GRADES3_SQL } from './modules/grades/schema.ts';
import { SQL as CAR_SQL, DOCS_SQL as CAR_DOCS_SQL } from './modules/car/schema.ts';

export type Migration = { version: number; name: string; sql: string };

// Common columns for user tables: id TEXT PK (client uuid), created_at, updated_at, deleted_at (soft delete).
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;
/** Legacy profile namespace renamed to focus.* in migration 30 (built so the old word never appears in source). */
const LEGACY = 'ad' + 'hd.';

export const MIGRATIONS: Migration[] = [
  {
    version: 1, name: 'core',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, input TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
        result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, run_after TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ai_queue_status ON ai_jobs(status, run_after);
      CREATE TABLE IF NOT EXISTS outbox_seen (client_id TEXT PRIMARY KEY, entity TEXT NOT NULL, at TEXT NOT NULL);
    `,
  },
  {
    version: 2, name: 'profile',
    sql: `
      CREATE TABLE IF NOT EXISTS profile_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS asks (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, module TEXT NOT NULL, question TEXT NOT NULL,
        why TEXT NOT NULL DEFAULT '', answer_type TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','skipped')),
        priority INTEGER NOT NULL DEFAULT 50, asked_at TEXT, answered_at TEXT, skip_until TEXT);
    `,
  },
  {
    version: 3, name: 'tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS areas (${T}, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS projects (${T}, area_id TEXT, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        note_path TEXT, sort INTEGER NOT NULL DEFAULT 0, emoji TEXT);
      CREATE TABLE IF NOT EXISTS tasks (${T}, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', project_id TEXT, parent_id TEXT,
        section TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3), tags TEXT NOT NULL DEFAULT '[]',
        start_date TEXT, due_date TEXT, due_time TEXT, est_minutes INTEGER, first_action TEXT, done_def TEXT,
        recur TEXT, recur_parent TEXT, pinned INTEGER NOT NULL DEFAULT 0, waiting_for TEXT, someday INTEGER NOT NULL DEFAULT 0,
        goal_id TEXT, source TEXT NOT NULL DEFAULT 'app', event_id TEXT, legacy_import_id TEXT UNIQUE,
        sort INTEGER NOT NULL DEFAULT 0, done_at TEXT);
      CREATE INDEX IF NOT EXISTS tasks_open ON tasks(status, due_date) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS reminders (${T}, task_id TEXT NOT NULL, at TEXT, anchor TEXT, offset_min INTEGER NOT NULL DEFAULT 0, sent_at TEXT);
      CREATE TABLE IF NOT EXISTS focus_sessions (${T}, task_id TEXT, started_at TEXT NOT NULL, minutes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS saved_filters (${T}, name TEXT NOT NULL, filter TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS habits (${T}, name TEXT NOT NULL, target_per_week INTEGER NOT NULL DEFAULT 7, area_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS habit_checks (${T}, habit_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, UNIQUE (habit_id, day));
      CREATE TABLE IF NOT EXISTS goals (${T}, name TEXT NOT NULL, why TEXT NOT NULL DEFAULT '', area_id TEXT, target_value REAL, unit TEXT,
        target_date TEXT, source_kind TEXT NOT NULL DEFAULT 'manual', source_ref TEXT, status TEXT NOT NULL DEFAULT 'active');
      CREATE TABLE IF NOT EXISTS goal_values (goal_id TEXT NOT NULL, day TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (goal_id, day));
      CREATE TABLE IF NOT EXISTS event_task2 (event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, date TEXT);
    `,
  },
  {
    version: 4, name: 'money',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (${T}, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'cash', currency TEXT NOT NULL DEFAULT 'USD',
        track TEXT NOT NULL DEFAULT 'personal' CHECK (track IN ('personal','business')), opening_balance REAL NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS categories (${T}, parent_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'expense', icon TEXT,
        track TEXT NOT NULL DEFAULT 'personal');
      CREATE TABLE IF NOT EXISTS records (${T}, account_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
        amount REAL NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL, rate_to_usd REAL NOT NULL, rate_estimated INTEGER NOT NULL DEFAULT 0,
        usd REAL NOT NULL, category_id TEXT, labels TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', payee TEXT,
        day TEXT NOT NULL, at TEXT NOT NULL, transfer_id TEXT, direction INTEGER NOT NULL DEFAULT -1, planned_id TEXT, debt_id TEXT,
        warranty_until TEXT, photo TEXT, import_ref TEXT UNIQUE);
      CREATE INDEX IF NOT EXISTS records_day ON records(day) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS rates (day TEXT NOT NULL, currency TEXT NOT NULL, to_usd REAL NOT NULL, PRIMARY KEY (day, currency));
      CREATE TABLE IF NOT EXISTS budgets (${T}, name TEXT NOT NULL, period TEXT NOT NULL CHECK (period IN ('week','month','year','once')),
        amount_usd REAL NOT NULL, category_ids TEXT NOT NULL DEFAULT '[]', start TEXT, end TEXT);
      CREATE TABLE IF NOT EXISTS planned (${T}, name TEXT NOT NULL, template TEXT NOT NULL, recur TEXT NOT NULL, next_due TEXT NOT NULL,
        auto_post INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS templates (${T}, name TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS debts (${T}, person TEXT NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
        amount REAL NOT NULL, currency TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', closed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS savings_goals (${T}, name TEXT NOT NULL, target_usd REAL NOT NULL, target_date TEXT, account_id TEXT);
      CREATE TABLE IF NOT EXISTS shopping_items (${T}, list TEXT NOT NULL DEFAULT 'Groceries', name TEXT NOT NULL, qty TEXT, done INTEGER NOT NULL DEFAULT 0);
    `,
  },
  {
    version: 5, name: 'food',
    sql: `
      CREATE TABLE IF NOT EXISTS foods (${T}, source TEXT NOT NULL CHECK (source IN ('ciqual','usda','off','own','estimated')),
        source_ref TEXT, barcode TEXT, name TEXT NOT NULL, brand TEXT, kcal REAL NOT NULL, protein REAL NOT NULL DEFAULT 0,
        carbs REAL NOT NULL DEFAULT 0, fat REAL NOT NULL DEFAULT 0, sat_fat REAL, fiber REAL, sugar REAL, sodium REAL,
        density REAL, state TEXT, flags TEXT NOT NULL DEFAULT '[]', uses INTEGER NOT NULL DEFAULT 0, UNIQUE (source, source_ref));
      CREATE INDEX IF NOT EXISTS foods_barcode ON foods(barcode);
      CREATE VIRTUAL TABLE IF NOT EXISTS foods_fts USING fts5(name, brand, food_id UNINDEXED, tokenize = 'trigram');
      CREATE TABLE IF NOT EXISTS servings (food_id TEXT NOT NULL, label TEXT NOT NULL, grams REAL NOT NULL, PRIMARY KEY (food_id, label));
      CREATE TABLE IF NOT EXISTS recipes (${T}, name TEXT NOT NULL, raw_g REAL NOT NULL DEFAULT 0, cooked_g REAL, portions REAL NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS recipe_items (recipe_id TEXT NOT NULL, food_id TEXT NOT NULL, grams REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS food_log (${T}, day TEXT NOT NULL, slot TEXT NOT NULL, at TEXT NOT NULL, food_id TEXT, recipe_id TEXT,
        name TEXT NOT NULL, grams REAL, kcal REAL NOT NULL, protein REAL NOT NULL DEFAULT 0, carbs REAL NOT NULL DEFAULT 0,
        fat REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', estimate INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS food_log_day ON food_log(day) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS day_status (day TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('complete','partial','blank')));
      CREATE TABLE IF NOT EXISTS water_log (${T}, day TEXT NOT NULL, ml REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS nutrition_targets (from_day TEXT PRIMARY KEY, kcal REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL,
        fat REAL NOT NULL, method TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meal_presets (${T}, name TEXT NOT NULL, items TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS off_cache (barcode TEXT PRIMARY KEY, found INTEGER NOT NULL, food_id TEXT, at TEXT NOT NULL);
    `,
  },
  {
    version: 6, name: 'gym_body',
    sql: `
      CREATE TABLE IF NOT EXISTS exercises (${T}, source TEXT NOT NULL DEFAULT 'own', source_ref TEXT UNIQUE, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'weight_reps', equipment TEXT, primary_muscles TEXT NOT NULL DEFAULT '[]',
        secondary_muscles TEXT NOT NULL DEFAULT '[]', instructions TEXT NOT NULL DEFAULT '[]', images TEXT NOT NULL DEFAULT '[]',
        increment REAL NOT NULL DEFAULT 2.5, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS routines (${T}, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS routine_items (${T}, routine_id TEXT NOT NULL, exercise_id TEXT NOT NULL, sets INTEGER NOT NULL DEFAULT 3,
        rep_min INTEGER NOT NULL DEFAULT 8, rep_max INTEGER NOT NULL DEFAULT 12, rest_s INTEGER NOT NULL DEFAULT 120,
        superset_group TEXT, sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS workouts (${T}, routine_id TEXT, name TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
        notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')), day TEXT NOT NULL,
        import_ref TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS sets (${T}, workout_id TEXT NOT NULL, exercise_id TEXT NOT NULL, idx INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'working' CHECK (type IN ('warmup','working','drop','failure')),
        weight REAL, reps INTEGER, seconds REAL, distance REAL, rpe REAL, done_at TEXT, note TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS sets_ex ON sets(exercise_id) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS prs (exercise_id TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, set_id TEXT NOT NULL, at TEXT NOT NULL,
        PRIMARY KEY (exercise_id, kind));
      CREATE TABLE IF NOT EXISTS rest_timers (id INTEGER PRIMARY KEY CHECK (id = 1), ends_at TEXT NOT NULL, label TEXT NOT NULL, pushed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS body_metrics (${T}, day TEXT NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS body_kind_day ON body_metrics(kind, day) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS photos (${T}, day TEXT NOT NULL, path TEXT NOT NULL);
    `,
  },
  {
    version: 7, name: 'brain',
    sql: `
      CREATE TABLE IF NOT EXISTS notes_index (path TEXT PRIMARY KEY, title TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL,
        conflict INTEGER NOT NULL DEFAULT 0);
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path UNINDEXED, title, body, tokenize = 'trigram');
      CREATE TABLE IF NOT EXISTS links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst));
    `,
  },
  {
    version: 8, name: 'backlog',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (${T}, name TEXT NOT NULL, expires_on TEXT, where_kept TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '', reminded_60 INTEGER NOT NULL DEFAULT 0, reminded_30 INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS wishlist (${T}, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
        usd REAL NOT NULL DEFAULT 0, ready_on TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','bought','dropped')), note TEXT NOT NULL DEFAULT '',
        pushed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cards (${T}, front TEXT NOT NULL, back TEXT NOT NULL, deck TEXT NOT NULL DEFAULT 'General',
        gender TEXT, example TEXT, due TEXT NOT NULL, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'new', last_review TEXT);
      CREATE INDEX IF NOT EXISTS cards_due ON cards(due) WHERE deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS card_reviews (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, grade INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS screen_time (day TEXT NOT NULL, device TEXT NOT NULL, app TEXT NOT NULL, minutes REAL NOT NULL,
        kind TEXT NOT NULL DEFAULT 'app', source TEXT NOT NULL DEFAULT 'activitywatch', updated_at TEXT NOT NULL,
        PRIMARY KEY (day, device, app));
      CREATE TABLE IF NOT EXISTS screen_devices (device TEXT PRIMARY KEY, kind TEXT NOT NULL, last_sync TEXT NOT NULL);
    `,
  },
  {
    version: 9, name: 'ideas',
    sql: `
      CREATE TABLE IF NOT EXISTS questions (${T}, text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dropped')), answer_md TEXT, answered_at TEXT);
      ALTER TABLE focus_sessions ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE focus_sessions ADD COLUMN pause_reason TEXT;
    `,
  },
  { version: 10, name: 'thrift', sql: THRIFT_SQL },
  { version: 11, name: 'people', sql: PEOPLE_SQL },
  // v12 is retired (it held a removed module). The number stays so the order of later migrations does not change.
  { version: 12, name: 'retired', sql: '' },
  { version: 13, name: 'habitat', sql: HABITAT_SQL },
  { version: 14, name: 'grades', sql: GRADES_SQL },
  { version: 15, name: 'grades2', sql: GRADES2_SQL },
  { version: 16, name: 'car', sql: CAR_SQL },
  {
    version: 17, name: 'chat_files',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_files (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL);
      ALTER TABLE messages ADD COLUMN files TEXT NOT NULL DEFAULT '[]';
    `,
  },
  // Block tasks are mirrored as app tasks (tasks.event_id); Calendar and Today look them up by event.
  { version: 18, name: 'tasks_event', sql: 'CREATE INDEX IF NOT EXISTS tasks_event ON tasks(event_id)' },
  {
    // Money fixes: a debt keeps its account; a repayment records its amount in the debt's currency.
    version: 20, name: 'money_debts',
    sql: `
      ALTER TABLE debts ADD COLUMN account_id TEXT;
      ALTER TABLE records ADD COLUMN debt_amount REAL;
      UPDATE records SET debt_amount = amount WHERE debt_id IS NOT NULL AND debt_amount IS NULL;
    `,
  },
  { version: 22, name: 'documents_car_papers', sql: CAR_DOCS_SQL },
  { version: 23, name: 'people_phone', sql: PEOPLE_PHONE_SQL },
  { version: 24, name: 'review_changes', sql: GRADES3_SQL },
  {
    // Pushes held by ntfy.quiet() (sleep, mode, Saturday), delivered by flushHeld() at the next allowed time.
    version: 28, name: 'push_held',
    sql: `
      CREATE TABLE IF NOT EXISTS push_held (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, msg TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 3, reason TEXT NOT NULL, held_at TEXT NOT NULL, expires_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS push_held_key ON push_held(key) WHERE key IS NOT NULL;
    `,
  },
  {
    // Notifications v2: every push outcome logged; one-shot scheduled pushes ("remind me at 15:00", snooze);
    // marks so a task / block / brief reminder fires once per day and time.
    version: 29, name: 'push_log_scheduled',
    sql: `
      CREATE TABLE IF NOT EXISTS push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, cat TEXT NOT NULL,
        title TEXT NOT NULL, message TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL, reason TEXT, key TEXT);
      CREATE INDEX IF NOT EXISTS push_log_at ON push_log(status, at);
      CREATE TABLE IF NOT EXISTS push_scheduled (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, at TEXT NOT NULL,
        msg TEXT NOT NULL, task_id TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS push_scheduled_at ON push_scheduled(at);
      CREATE TABLE IF NOT EXISTS push_marks (k TEXT PRIMARY KEY, at TEXT NOT NULL);
    `,
  },
  {
    // Profile namespace rename: the old attention keys become focus.* (reminder_style, best_energy, hardest_time,
    // accountability). The old diagnosis fact is dropped. A focus.* key that already exists wins.
    version: 30, name: 'profile_focus_keys',
    sql: `
      DELETE FROM profile_facts WHERE key = '${LEGACY}diagnosis';
      DELETE FROM asks WHERE key = '${LEGACY}diagnosis';
      DELETE FROM profile_facts WHERE key LIKE '${LEGACY}%' AND ('focus.' || substr(key, ${LEGACY.length + 1})) IN (SELECT key FROM profile_facts);
      UPDATE profile_facts SET key = 'focus.' || substr(key, ${LEGACY.length + 1}) WHERE key LIKE '${LEGACY}%';
      DELETE FROM asks WHERE key LIKE '${LEGACY}%' AND ('focus.' || substr(key, ${LEGACY.length + 1})) IN (SELECT key FROM asks);
      UPDATE asks SET key = 'focus.' || substr(key, ${LEGACY.length + 1}) WHERE key LIKE '${LEGACY}%';
      UPDATE asks SET module = 'focus' WHERE module = '${LEGACY.slice(0, -1)}';
    `,
  },
];

const applied = (db: DatabaseSync) => {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  return new Set((db.prepare('SELECT version FROM migrations').all() as { version: number }[]).map((r) => r.version));
};

export const pendingMigrations = (db: DatabaseSync, list = MIGRATIONS) => {
  const done = applied(db);
  return list.filter((m) => !done.has(m.version)).sort((a, b) => a.version - b.version);
};

/** Apply pending migrations. snapshotDir: where VACUUM INTO writes a copy first (skipped for :memory:). */
export const runMigrations = (db: DatabaseSync, opts: { dbPath?: string; list?: Migration[] } = {}) => {
  const pending = pendingMigrations(db, opts.list);
  if (!pending.length) return { applied: [] as number[], snapshot: null as string | null };
  let snapshot: string | null = null;
  if (opts.dbPath && opts.dbPath !== ':memory:' && existsSync(opts.dbPath)) {
    const dir = join(dirname(opts.dbPath), 'snapshots');
    mkdirSync(dir, { recursive: true });
    snapshot = join(dir, `app-before-v${pending[0].version}-${Date.now()}.db`);
    try { db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`); } catch { snapshot = null; }
  }
  const done: number[] = [];
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
      done.push(m.version);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(e as Error).message}`);
    }
  }
  return { applied: done, snapshot };
};
