// Brain: vault index (FTS5 trigram), [[wikilinks]] + backlinks, one search across notes/tasks/foods/money.
// Index lives in app.db; the vault stays the source of truth. Files > 1 MB and binaries are skipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VAULT } from '../../config.ts';
import { AppError } from '../../errors.ts';
import { all, one, run } from '../util.ts';

const MAX_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set(['.obsidian', '.stversions', '.trash', '.git', '.stfolder', 'node_modules']);
const CONFLICT_RE = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}/;
const LINK_RE = /\[\[([^\]|#^\n]+)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/** Note name used for link matching: basename without .md, lowercased. */
export const linkName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '').trim().toLowerCase();

const walk = (dir: string, rel: string, out: { rel: string; abs: string }[]) => {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.syncthing.') || e.name.endsWith('.tmp')) continue;
    const abs = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, r, out); }
    else if (e.isFile() && /\.md$/i.test(e.name)) out.push({ rel: r, abs });
  }
};

export const titleOf = (path: string, body: string) => {
  const block = body.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const fm = block?.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  if (fm) return fm[1].trim().slice(0, 200);
  const h = body.match(/^#\s+(.+)$/m);
  return (h ? h[1] : path.split('/').pop()!.replace(/\.md$/i, '')).trim().slice(0, 200);
};

export const linksOf = (body: string) => {
  const s = new Set<string>();
  for (const m of body.matchAll(LINK_RE)) {
    const t = m[1].trim();
    if (t) s.add(linkName(t));
  }
  return [...s];
};

/**
 * Scan the vault. Only files whose mtime/size changed are re-read. Deleted files leave the index.
 * Returns counts. Safe to run every 5 minutes.
 */
export const scanVault = (root = VAULT) => {
  const files: { rel: string; abs: string }[] = [];
  walk(root, '', files);
  const known = new Map(all<{ path: string; mtime: number; size: number }>('SELECT path, mtime, size FROM notes_index').map((r) => [r.path, r]));
  const seen = new Set<string>();
  let indexed = 0, skipped = 0, removed = 0;
  run('BEGIN');
  try {
    for (const f of files) {
      let st;
      try { st = statSync(f.abs); } catch { continue; }
      if (st.size > MAX_BYTES) { skipped++; continue; }
      seen.add(f.rel);
      const k = known.get(f.rel);
      if (k && k.mtime === st.mtimeMs && k.size === st.size) continue;
      const buf = readFileSync(f.abs);
      if (buf.includes(0)) { seen.delete(f.rel); skipped++; continue; }
      const body = buf.toString('utf8').replace(/\r\n/g, '\n');
      const title = titleOf(f.rel, body);
      run(`INSERT INTO notes_index (path, title, mtime, size, conflict) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET title = excluded.title, mtime = excluded.mtime, size = excluded.size, conflict = excluded.conflict`,
        f.rel, title, st.mtimeMs, st.size, CONFLICT_RE.test(f.rel) ? 1 : 0);
      run('DELETE FROM notes_fts WHERE path = ?', f.rel);
      run('INSERT INTO notes_fts (path, title, body) VALUES (?, ?, ?)', f.rel, title, body);
      run('DELETE FROM links WHERE src = ?', f.rel);
      for (const d of linksOf(body)) run('INSERT INTO links (src, dst) VALUES (?, ?) ON CONFLICT DO NOTHING', f.rel, d);
      indexed++;
    }
    for (const p of known.keys()) {
      if (seen.has(p)) continue;
      run('DELETE FROM notes_index WHERE path = ?', p);
      run('DELETE FROM notes_fts WHERE path = ?', p);
      run('DELETE FROM links WHERE src = ?', p);
      removed++;
    }
    run('COMMIT');
  } catch (e) { run('ROLLBACK'); throw e; }
  return { files: files.length, indexed, skipped, removed, total: Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM notes_index')!.n) };
};

/** Notes that link to `path` (by note name), and notes `path` links to. */
export const backlinks = (path: string) => {
  const name = linkName(path);
  const inbound = all<{ path: string; title: string }>(
    `SELECT n.path, n.title FROM links l JOIN notes_index n ON n.path = l.src WHERE l.dst = ? AND l.src <> ? ORDER BY n.mtime DESC`, name, path);
  const outbound = all<{ dst: string; path: string | null }>(
    `SELECT l.dst, (SELECT n.path FROM notes_index n WHERE lower(replace(n.path, '.md', '')) = l.dst OR lower(replace(n.path, '.md', '')) LIKE '%/' || l.dst LIMIT 1) AS path
     FROM links l WHERE l.src = ? ORDER BY l.dst`, path);
  return { path, inbound, outbound: outbound.map((o) => ({ name: o.dst, path: o.path, exists: o.path !== null })) };
};

const like = (s: string) => '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
const ftsPhrase = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** snippet is plain text for Claude; amount/currency/kcal/status let the app format numbers itself. */
export type Hit = {
  kind: 'note' | 'task' | 'food' | 'record' | 'workout'; id: string; title: string; snippet?: string; day?: string; conflict?: boolean;
  amount?: number; currency?: string; income?: boolean; kcal?: number; status?: string;
};

/** Search notes only. 3+ chars → FTS trigram; shorter → LIKE on title/body. */
export const searchNotesIndex = (q: string, limit = 20): Hit[] => {
  const s = String(q ?? '').trim();
  if (!s) return [];
  const n = Math.max(1, Math.min(100, limit));
  const rows = [...s].length >= 3
    ? all<{ path: string; title: string; snip: string }>(
      `SELECT f.path, f.title, snippet(notes_fts, 2, '«', '»', '…', 12) AS snip FROM notes_fts f WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`, ftsPhrase(s), n)
    : all<{ path: string; title: string; snip: string }>(
      `SELECT path, title, substr(body, 1, 120) AS snip FROM notes_fts WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' LIMIT ?`, like(s), like(s), n);
  const conf = new Set(all<{ path: string }>('SELECT path FROM notes_index WHERE conflict = 1').map((r) => r.path));
  return rows.map((r) => ({ kind: 'note', id: r.path, title: r.title, snippet: r.snip, conflict: conf.has(r.path) }));
};

/** One search across the vault, tasks, foods, money records and workouts. Business data is not here. */
export const brainSearch = (q: string, o: { kinds?: Hit['kind'][]; limit?: number } = {}) => {
  const s = String(q ?? '').trim();
  if (s.length > 200) throw new AppError('bad_request', 'Query is too long (200 max)');
  const kinds = new Set(o.kinds?.length ? o.kinds : ['note', 'task', 'food', 'record', 'workout']);
  const n = Math.max(1, Math.min(50, o.limit ?? 10));
  const out: Record<string, Hit[]> = {};
  if (!s) return { q: s, results: out, total: 0 };
  const L = like(s);
  if (kinds.has('note')) out.note = searchNotesIndex(s, n);
  if (kinds.has('task')) out.task = all<{ id: string; title: string; status: string; due_date: string | null }>(
    `SELECT id, title, status, due_date FROM tasks WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
     ORDER BY status = 'open' DESC, updated_at DESC LIMIT ?`, L, L, n)
    .map((r) => ({ kind: 'task', id: r.id, title: r.title, snippet: r.status, status: r.status, day: r.due_date ?? undefined }));
  if (kinds.has('food')) out.food = all<{ id: string; name: string; brand: string | null; kcal: number }>(
    `SELECT id, name, brand, kcal FROM foods WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\') ORDER BY uses DESC, name LIMIT ?`, L, L, n)
    .map((r) => ({ kind: 'food', id: r.id, title: r.brand ? `${r.name} (${r.brand})` : r.name, snippet: `${r.kcal} kcal/100 g`, kcal: r.kcal }));
  if (kinds.has('record')) out.record = all<{ id: string; note: string | null; payee: string | null; amount: number; currency: string; day: string; kind: string }>(
    `SELECT r.id, r.note, r.payee, r.amount, r.currency, r.day, r.kind FROM records r JOIN accounts a ON a.id = r.account_id
     WHERE r.deleted_at IS NULL AND a.track = 'personal' AND (r.note LIKE ? ESCAPE '\\' OR r.payee LIKE ? ESCAPE '\\') ORDER BY r.day DESC LIMIT ?`, L, L, n)
    .map((r) => ({ kind: 'record', id: r.id, title: r.payee || r.note || r.kind, snippet: `${r.kind} ${r.amount} ${r.currency}`, amount: r.amount, currency: r.currency, income: r.kind === 'income', day: r.day }));
  if (kinds.has('workout')) out.workout = all<{ id: string; name: string; day: string }>(
    `SELECT id, name, day FROM workouts WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\') ORDER BY started_at DESC LIMIT ?`, L, L, n)
    .map((r) => ({ kind: 'workout', id: r.id, title: r.name, day: r.day }));
  return { q: s, results: out, total: Object.values(out).reduce((a, b) => a + b.length, 0) };
};
