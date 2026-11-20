// Tables for the thrift module (migration owned by this module). T = common columns.
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;
export const SQL = `
  CREATE TABLE IF NOT EXISTS skipped_buys (${T}, name TEXT NOT NULL, amount REAL NOT NULL CHECK (amount >= 0), currency TEXT NOT NULL,
    rate_to_usd REAL NOT NULL, rate_estimated INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL, day TEXT NOT NULL, wish_id TEXT,
    note TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS skipped_buys_day ON skipped_buys(day) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS record_for (${T}, record_id TEXT NOT NULL UNIQUE, who TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS record_for_who ON record_for(who) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS shop_overrides (${T}, name_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, store TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS gym_next_notes (${T}, exercise_id TEXT NOT NULL, note TEXT NOT NULL, shown_at TEXT, acked_at TEXT);
  CREATE INDEX IF NOT EXISTS gym_next_notes_ex ON gym_next_notes(exercise_id) WHERE deleted_at IS NULL;
`;
