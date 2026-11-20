// Tables for the grades + goals v2 module (migration v14). T = common columns.
// Life areas get a key/emoji/vision; goals get start/auto/horizon/next step; milestones, links, day ratings,
// weekly grade snapshots and per-input target overrides.
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;
export const SQL = `
  ALTER TABLE areas ADD COLUMN key TEXT;
  ALTER TABLE areas ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
  ALTER TABLE areas ADD COLUMN vision TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX IF NOT EXISTS areas_key ON areas(key) WHERE key IS NOT NULL AND deleted_at IS NULL;
  ALTER TABLE goals ADD COLUMN start_value REAL;
  ALTER TABLE goals ADD COLUMN start_day TEXT;
  ALTER TABLE goals ADD COLUMN auto TEXT;
  ALTER TABLE goals ADD COLUMN horizon TEXT NOT NULL DEFAULT 'year';
  ALTER TABLE goals ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE goals ADD COLUMN next_step TEXT NOT NULL DEFAULT '';
  ALTER TABLE goals ADD COLUMN done_at TEXT;
  ALTER TABLE goals ADD COLUMN seed_key TEXT;
  ALTER TABLE goals ADD COLUMN paused_at TEXT;
  ALTER TABLE goals ADD COLUMN outcome INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX IF NOT EXISTS goals_seed_key ON goals(seed_key) WHERE seed_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS goal_milestones (${T}, goal_id TEXT NOT NULL, name TEXT NOT NULL, due TEXT, done_at TEXT,
    sort INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS goal_milestones_goal ON goal_milestones(goal_id) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS goal_links (${T}, goal_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('habit','project')),
    ref TEXT NOT NULL, UNIQUE (goal_id, kind, ref));
  CREATE TABLE IF NOT EXISTS day_ratings (${T}, day TEXT NOT NULL UNIQUE, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS grade_weeks (week_start TEXT NOT NULL, area_key TEXT NOT NULL, letter TEXT, score REAL,
    facts TEXT NOT NULL DEFAULT '[]', computed_at TEXT NOT NULL, PRIMARY KEY (week_start, area_key));
  CREATE TABLE IF NOT EXISTS grade_targets (area_key TEXT NOT NULL, input TEXT NOT NULL, target REAL NOT NULL CHECK (target > 0),
    updated_at TEXT NOT NULL, PRIMARY KEY (area_key, input));
`;

// Migration v15 (grades2): floor/stretch targets, weekly confidence, day-rating tags, quiet-area dismissals.
export const SQL2 = `
  ALTER TABLE goals ADD COLUMN floor_value REAL;
  ALTER TABLE goals ADD COLUMN stretch_value REAL;
  CREATE TABLE IF NOT EXISTS goal_confidence (week_start TEXT NOT NULL, goal_id TEXT NOT NULL, ask_key TEXT NOT NULL,
    value INTEGER CHECK (value IS NULL OR value BETWEEN 1 AND 5), PRIMARY KEY (week_start, goal_id));
  ALTER TABLE day_ratings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE IF NOT EXISTS quiet_dismiss (area_key TEXT PRIMARY KEY, until TEXT NOT NULL);
`;

// Migration v24: the weekly "one change".
export const SQL3 = `
  CREATE TABLE IF NOT EXISTS review_changes (week_start TEXT PRIMARY KEY, text TEXT NOT NULL, accepted_at TEXT,
    edited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
`;
