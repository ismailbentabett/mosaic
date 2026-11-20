// Tables for the people module (migration owned by this module). T = common columns.
// Promises, tiny habits, time capsules, people light, occasions, waiting check-on dates.
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;
export const SQL = `
  CREATE TABLE IF NOT EXISTS promises (${T}, who TEXT NOT NULL, what TEXT NOT NULL, due TEXT, source TEXT,
    task_id TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','kept','released')),
    closed_day TEXT, closed_at TEXT);
  CREATE INDEX IF NOT EXISTS promises_open ON promises(status, due) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS habit_tiny (${T}, habit_id TEXT NOT NULL UNIQUE, tiny TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS habit_check_kind (${T}, habit_id TEXT NOT NULL, day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('tiny','full')), UNIQUE (habit_id, day));
  CREATE TABLE IF NOT EXISTS capsules (${T}, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, written_day TEXT NOT NULL,
    open_on TEXT NOT NULL, opened_at TEXT);
  CREATE INDEX IF NOT EXISTS capsules_open ON capsules(open_on) WHERE deleted_at IS NULL AND opened_at IS NULL;
  CREATE TABLE IF NOT EXISTS people (${T}, name TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'other' CHECK (relation IN ('family','friend','other')),
    birthday TEXT, last_contact TEXT, cadence_days INTEGER, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS person_contacts (${T}, person_id TEXT NOT NULL, day TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS person_contacts_person ON person_contacts(person_id, day);
  CREATE TABLE IF NOT EXISTS occasions (${T}, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other', md TEXT NOT NULL,
    year INTEGER, person_id TEXT, lead_days INTEGER NOT NULL DEFAULT 7, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS waiting_checks (${T}, task_id TEXT NOT NULL UNIQUE, check_on TEXT NOT NULL,
    waiting_for TEXT, auto INTEGER NOT NULL DEFAULT 0);
`;

// Migration 23: people get an optional phone (for tel: / WhatsApp).
export const SQL23 = `
  ALTER TABLE people ADD COLUMN phone TEXT;
`;
