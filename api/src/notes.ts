// Vault notes (Markdown only). Every path goes through resolveVaultPath; writes are atomic so Syncthing
// never syncs a half-written file (it ignores `.syncthing.*.tmp`).
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync,
  copyFileSync, unlinkSync, type Stats,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { VAULT, DATA_DIR } from './config.ts';
import { AppError, fail } from './errors.ts';
import { hhmm, today } from './time.ts';

const MAX_BYTES = 1024 * 1024;
const BLOCKED_DIRS = new Set(['.obsidian', '.stversions', '.trash', '.git', '.stfolder']);
const CONFLICT_RE = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}/;

const vaultReal = () => {
  mkdirSync(VAULT, { recursive: true });
  return realpathSync(VAULT);
};
const inside = (root: string, p: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const toRel = (abs: string) => relative(vaultReal(), abs).split(sep).join('/');

/** Vault-relative → absolute path, locked inside the vault's realpath. `.md` only. */
export const resolveVaultPath = (rel: string): string => {
  if (typeof rel !== 'string' || !rel.trim()) fail('bad_request', 'path is required');
  if (rel.includes('\0')) fail('bad_request', 'Bad path');
  if (rel.includes('\\') || isAbsolute(rel) || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) fail('bad_request', 'Path must be vault-relative with / separators');
  const segs = rel.split('/').filter((s) => s !== '' && s !== '.');
  if (!segs.length) fail('bad_request', 'path is required');
  if (segs.some((s) => s === '..')) fail('bad_request', 'Path may not contain ..');
  if (segs.some((s) => BLOCKED_DIRS.has(s))) fail('bad_request', 'That folder is not editable');
  if (!/\.md$/i.test(segs[segs.length - 1]) || segs[segs.length - 1].length <= 3) fail('bad_request', 'Only .md files');

  const root = vaultReal();
  // realpath of the deepest existing ancestor, then re-append the missing tail.
  let existing = join(root, ...segs);
  const tail: string[] = [];
  while (!existsSync(existing)) {
    tail.unshift(basename(existing));
    existing = dirname(existing);
  }
  const real = join(realpathSync(existing), ...tail);
  if (!inside(root, real) || real === root) fail('bad_request', 'Path escapes the vault');
  return real;
};

const mtimeOf = (st: Stats) => Math.floor(st.mtimeMs);

const atomicWrite = (abs: string, content: string) => {
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = join(dirname(abs), `.syncthing.${basename(abs)}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, abs);
  return mtimeOf(statSync(abs));
};

const checkSize = (content: string) => {
  if (typeof content !== 'string') fail('bad_request', 'content must be a string');
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) fail('bad_request', 'Note too large (max 1 MB)');
};

const titleOf = (abs: string, content?: string) => {
  try {
    const text = content ?? readFileSync(abs, 'utf8').slice(0, 8192);
    const m = text.match(/^# +(.+?)\s*$/m);
    if (m) return m[1];
  } catch { /* fall back to filename */ }
  return basename(abs).replace(/\.md$/i, '');
};

/** All .md files in the vault (skips dot-dirs and symlinks). */
const walk = (dir = vaultReal(), out: { abs: string; st: Stats }[] = []) => {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (e.isFile() && /\.md$/i.test(e.name)) {
      try { out.push({ abs, st: statSync(abs) }); } catch { /* vanished */ }
    }
  }
  return out;
};

export const recentNotes = async () => {
  const files = walk().filter((f) => !CONFLICT_RE.test(basename(f.abs)));
  const notes = files
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    .slice(0, 30)
    .map((f) => ({ path: toRel(f.abs), title: titleOf(f.abs), mtime: mtimeOf(f.st), size: f.st.size }));

  const root = vaultReal();
  const pinnedRel = ['Home.md', 'Today.md', 'Inbox.md'];
  const projDir = join(root, 'Projects');
  if (existsSync(projDir)) {
    const ents = readdirSync(projDir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (e.isFile() && /\.md$/i.test(e.name)) pinnedRel.push(`Projects/${e.name}`);
      else if (e.isDirectory() && existsSync(join(projDir, e.name, 'README.md'))) pinnedRel.push(`Projects/${e.name}/README.md`);
    }
  }
  const pinned = pinnedRel
    .filter((p) => existsSync(join(root, ...p.split('/'))))
    .slice(0, 8)
    .map((p) => ({ path: p, title: titleOf(join(root, ...p.split('/'))) }));

  const todayPath = `Log/${today()}.md`;
  return { notes, pinned, today: { path: todayPath, exists: existsSync(join(root, 'Log', `${today()}.md`)) } };
};

export const searchNotes = async (q: string) => {
  const query = typeof q === 'string' ? q.trim() : '';
  if (query.length < 1 || query.length > 200) fail('bad_request', 'q must be 1–200 characters');
  const needle = query.toLowerCase();
  const files = walk().filter((f) => f.st.size <= MAX_BYTES).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const byName: { path: string; title: string; line: number; snippet: string }[] = [];
  const byText: typeof byName = [];
  for (const f of files) {
    let content: string;
    try { content = readFileSync(f.abs, 'utf8'); } catch { continue; }
    const path = toRel(f.abs);
    const title = titleOf(f.abs, content);
    if (basename(f.abs).toLowerCase().includes(needle)) byName.push({ path, title, line: 0, snippet: title });
    if (byText.length >= 50) continue;
    let hits = 0;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length && hits < 3; i++) {
      const at = lines[i].toLowerCase().indexOf(needle);
      if (at < 0) continue;
      hits++;
      const start = Math.max(0, at - 60);
      const s = lines[i].slice(start, start + 160).trim();
      byText.push({ path, title, line: i + 1, snippet: (start > 0 ? '…' : '') + s });
    }
  }
  return [...byName, ...byText].slice(0, 50);
};

export const readNote = async (rel: string) => {
  const abs = resolveVaultPath(rel);
  let st: Stats;
  try { st = statSync(abs); } catch { return fail('not_found', `Note not found: ${rel}`); }
  if (!st.isFile()) fail('bad_request', 'Not a file');
  if (st.size > MAX_BYTES) fail('bad_request', 'Note too large (max 1 MB)');
  return { path: toRel(abs), content: readFileSync(abs, 'utf8'), mtime: mtimeOf(st) };
};

/** Optimistic concurrency: baseMtime must match the file's mtime (null/0 = create new). */
export const writeNote = async (rel: string, content: string, baseMtime: number | null) => {
  checkSize(content);
  const abs = resolveVaultPath(rel);
  if (existsSync(abs)) {
    const st = statSync(abs);
    if (!st.isFile()) fail('bad_request', 'Not a file');
    const cur = mtimeOf(st);
    if (cur !== baseMtime) {
      throw new AppError('conflict', 'The note changed since you opened it.', { mtime: cur, content: readFileSync(abs, 'utf8') });
    }
  }
  return { mtime: atomicWrite(abs, content) };
};

/** Append under today's `## YYYY-MM-DD` heading (adds it if the last dated heading isn't today). */
export const appendNote = async (rel: string, text: string) => {
  if (typeof text !== 'string' || !text.trim()) fail('bad_request', 'text is required');
  const abs = resolveVaultPath(rel);
  const d = today();
  let content = existsSync(abs) ? readFileSync(abs, 'utf8') : `# ${basename(abs).replace(/\.md$/i, '')}\n`;
  const dated = [...content.matchAll(/^## (\d{4}-\d{2}-\d{2})\b/gm)];
  if (content && !content.endsWith('\n')) content += '\n';
  if (dated[dated.length - 1]?.[1] !== d) content += `\n## ${d}\n`;
  content += text.replace(/\s+$/, '') + '\n';
  checkSize(content);
  return { mtime: atomicWrite(abs, content) };
};

/** Quick capture: `- HH:MM text` at the end of today's Log note. */
export const captureNote = async (text: string): Promise<{ path: string }> => {
  const line = typeof text === 'string' ? text.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  if (!line) fail('bad_request', 'text is required');
  const d = today();
  const rel = `Log/${d}.md`;
  const abs = resolveVaultPath(rel);
  let content = existsSync(abs) ? readFileSync(abs, 'utf8') : `# ${d}\n\n`;
  if (!content.endsWith('\n')) content += '\n';
  content += `- ${hhmm()} ${line}\n`;
  checkSize(content);
  atomicWrite(abs, content);
  return { path: rel };
};

// ---------- Syncthing conflicts ----------
const originalOf = (conflictRel: string) => conflictRel.replace(CONFLICT_RE, '');
const readOr = (abs: string) => (existsSync(abs) ? readFileSync(abs, 'utf8') : '');

export const listConflicts = async () => {
  const out: { conflict: string; original: string; conflictContent: string; originalContent: string }[] = [];
  for (const f of walk()) {
    if (!CONFLICT_RE.test(basename(f.abs)) || f.st.size > MAX_BYTES) continue;
    const conflict = toRel(f.abs);
    const original = originalOf(conflict);
    try {
      out.push({ conflict, original, conflictContent: readFileSync(f.abs, 'utf8'), originalContent: readOr(resolveVaultPath(original)) });
    } catch { /* unreadable or invalid name: skip */ }
  }
  return out;
};

export const resolveConflict = async (conflict: string, action: 'keep_original' | 'keep_conflict' | 'merge', content?: string) => {
  if (!CONFLICT_RE.test(basename(String(conflict ?? '')))) fail('bad_request', 'Not a sync-conflict file');
  const cAbs = resolveVaultPath(conflict);
  if (!existsSync(cAbs)) fail('not_found', `Conflict file not found: ${conflict}`);
  const oAbs = resolveVaultPath(originalOf(conflict));
  if (action === 'keep_conflict') atomicWrite(oAbs, readFileSync(cAbs, 'utf8'));
  else if (action === 'merge') {
    if (typeof content !== 'string') fail('bad_request', 'merge needs content');
    checkSize(content!);
    atomicWrite(oAbs, content!);
  } else if (action !== 'keep_original') fail('bad_request', `Unknown action: ${action}`);

  // Never delete: move the conflict copy out of the vault.
  const dir = join(DATA_DIR, 'resolved');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(dir, `${stamp}-${toRel(cAbs).replace(/\//g, '__')}`);
  try {
    renameSync(cAbs, dest);
  } catch {
    copyFileSync(cAbs, dest); // different filesystem: copy, then remove the vault copy
    unlinkSync(cAbs);
  }
  return { ok: true as const };
};
