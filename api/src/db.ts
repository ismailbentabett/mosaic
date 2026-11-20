// app.db (node:sqlite, WAL). Chat history, capture ids, job status, timer, checks. Not synced.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { runMigrations } from './migrate.ts';

let db: DatabaseSync | null = null;

export const getDb = () => {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  const path = process.env.MOSAIC_DB || join(DATA_DIR, 'app.db');
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_task (event_id TEXT PRIMARY KEY, task_id INTEGER NOT NULL, created_by_tool INTEGER NOT NULL DEFAULT 1, date TEXT);
    CREATE TABLE IF NOT EXISTS captures (client_id TEXT PRIMARY KEY, kind TEXT NOT NULL, result TEXT NOT NULL, ts TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timer (id INTEGER PRIMARY KEY CHECK (id = 1), label TEXT NOT NULL, started_at TEXT NOT NULL, ends_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, session_id TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', ts TEXT NOT NULL, error TEXT);
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS claude_lock (id INTEGER PRIMARY KEY CHECK (id = 1), run_id TEXT NOT NULL, label TEXT NOT NULL, pid INTEGER, started_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, label TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, fix TEXT, since TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, started TEXT NOT NULL, ended TEXT, ok INTEGER, message TEXT);
    CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs(job, id);
    CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, created TEXT NOT NULL);
  `);
  runMigrations(db, { dbPath: path });
  return db;
};

export const kvGet = (k: string): string | null => {
  const r = getDb().prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  return r?.v ?? null;
};
export const kvSet = (k: string, v: string) => {
  getDb()
    .prepare('INSERT INTO kv (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .run(k, v, new Date().toISOString());
};

/** Is a pid alive? Used to clear a stale claude_lock after a crash. */
export const pidAlive = (pid: number | null | undefined) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
