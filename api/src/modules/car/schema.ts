// Migration 16 (car): the car(s), odometer readings, fuel fills, service jobs, papers (insurance, registration…)
// and listings watched while buying the next car. Amounts are optional; when given they also land in money (records).
const T = `id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT`;

export const SQL = `
CREATE TABLE IF NOT EXISTS cars (${T},
  name TEXT NOT NULL, make TEXT, model TEXT, year INTEGER, plate TEXT,
  fuel TEXT NOT NULL DEFAULT 'petrol', tank_l REAL,
  status TEXT NOT NULL DEFAULT 'owned',
  bought_on TEXT, bought_price REAL, currency TEXT NOT NULL DEFAULT 'USD',
  start_km INTEGER, note TEXT, is_default INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS car_odometer (${T},
  car_id TEXT NOT NULL, day TEXT NOT NULL, km INTEGER NOT NULL, note TEXT);
CREATE INDEX IF NOT EXISTS car_odometer_car ON car_odometer (car_id, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS car_fuel (${T},
  car_id TEXT NOT NULL, day TEXT NOT NULL, km INTEGER, litres REAL, amount REAL, currency TEXT NOT NULL DEFAULT 'USD',
  full INTEGER NOT NULL DEFAULT 1, station TEXT, record_id TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS car_fuel_car ON car_fuel (car_id, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS car_service (${T},
  car_id TEXT NOT NULL, day TEXT NOT NULL, km INTEGER, kind TEXT NOT NULL DEFAULT 'other', title TEXT NOT NULL,
  amount REAL, currency TEXT NOT NULL DEFAULT 'USD', garage TEXT, record_id TEXT, note TEXT,
  next_km INTEGER, next_day TEXT);
CREATE INDEX IF NOT EXISTS car_service_car ON car_service (car_id, kind, day) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS car_papers (${T},
  car_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL, expires_on TEXT,
  amount REAL, currency TEXT NOT NULL DEFAULT 'USD', where_kept TEXT, record_id TEXT, note TEXT, paid_on TEXT);
CREATE INDEX IF NOT EXISTS car_papers_car ON car_papers (car_id, expires_on) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS car_listings (${T},
  title TEXT NOT NULL, year INTEGER, km INTEGER, price REAL, currency TEXT NOT NULL DEFAULT 'USD',
  url TEXT, place TEXT, status TEXT NOT NULL DEFAULT 'watching', note TEXT, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS car_listings_status ON car_listings (status, day) WHERE deleted_at IS NULL;
`;

// Migration 22: car papers become documents (one register, reminders at 60/30/7/0 days and once after).
// car_papers rows are copied with the same id and tag "car"; the old table stays as read-only history.
export const DOCS_SQL = `
ALTER TABLE documents ADD COLUMN car_id TEXT;
ALTER TABLE documents ADD COLUMN kind TEXT;
ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN amount REAL;
ALTER TABLE documents ADD COLUMN currency TEXT;
ALTER TABLE documents ADD COLUMN paid_on TEXT;
ALTER TABLE documents ADD COLUMN record_id TEXT;
ALTER TABLE documents ADD COLUMN reminded_7 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN reminded_0 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN reminded_after INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS documents_car ON documents (car_id, expires_on) WHERE deleted_at IS NULL;
INSERT OR IGNORE INTO documents (id, created_at, updated_at, deleted_at, name, expires_on, where_kept, note,
  car_id, kind, tags, amount, currency, paid_on, record_id)
SELECT id, created_at, updated_at, deleted_at, name, expires_on, COALESCE(where_kept, ''), COALESCE(note, ''),
  car_id, kind, '["car"]', amount, currency, paid_on, record_id FROM car_papers;
`;
