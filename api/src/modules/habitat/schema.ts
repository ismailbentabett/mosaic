// Tables for the habitat module (migration v13). T = common columns.
// Last-done board, lent/borrowed things, what-helped bank, tiny experiments.
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;
export const SQL = `
  CREATE TABLE IF NOT EXISTS last_done (${T}, name TEXT NOT NULL, last_at TEXT, note TEXT NOT NULL DEFAULT '');
  CREATE UNIQUE INDEX IF NOT EXISTS last_done_name ON last_done(lower(name)) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS lent_things (${T}, thing TEXT NOT NULL, person TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('lent','borrowed')), since TEXT NOT NULL, back_by TEXT,
    note TEXT NOT NULL DEFAULT '', returned_at TEXT);
  CREATE INDEX IF NOT EXISTS lent_things_open ON lent_things(returned_at) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS what_helped (${T}, situation TEXT NOT NULL, thing TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS experiments (${T}, name TEXT NOT NULL, hypothesis TEXT NOT NULL DEFAULT '', start_day TEXT NOT NULL,
    end_day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ended')), outcome_note TEXT NOT NULL DEFAULT '',
    ended_at TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS experiments_one_running ON experiments(status) WHERE status = 'running' AND deleted_at IS NULL;
`;
