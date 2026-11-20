// Task-app backup CSV (Folder Name / List Name / Title … columns) → app.db (tasks, projects, areas, reminders) + vault notes (NOTE items).
// Safe to re-run: every task carries a content hash in legacy_import_id (the export's taskId is only the row
// number and changes between exports), vault notes carry a <!-- tt:… --> marker and are appended, never rewritten.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VAULT } from '../../config.ts';
import { AppError } from '../../errors.ts';
import { TZ, isDate, lifeToday, zonedMs } from '../../time.ts';
import { all, db, insert, now, one, parseCsv, patch, uuid, type Row } from '../util.ts';
import { fromRRule } from './recur.ts';

/** What a note keeps in place of a login: the login itself goes to a task in the app (tag `login`), never into the synced vault. */
export const IN_APP = (title: string) => `Kept in the app: task "${title}", tag #login.`;
const bad = (m: string): never => { throw new AppError('bad_request', m); };

// ---------- pure helpers (exported for tests) ----------

/** Leading emoji of an exported list name, split from the name. */
export const splitEmoji = (s: string) => {
  const m = s.trim().match(/^([\p{Extended_Pictographic}‍️⃣\u{1F3FB}-\u{1F3FF}♀♂]+)\s*/u);
  return m ? { emoji: m[1], name: s.trim().slice(m[0].length).trim() || s.trim() } : { emoji: null, name: s.trim() };
};

const parts = (x: Date, tz: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = Object.fromEntries(f.formatToParts(x).map((p) => [p.type, p.value]));
  return { d: `${o.year}-${o.month}-${o.day}`, t: `${o.hour === '24' ? '00' : o.hour}:${o.minute}` };
};
const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

/**
 * The export stores every date as a UTC instant. All-day dates are local midnight in the task's own time zone
 * (a New York all-day task is 04:00Z), so the date must be read in that zone, with no time.
 * Timed dates are shown in the app's timezone (TZ).
 */
export const ttDate = (s: string, tz: string, allDay: string) => {
  if (!s) return { d: null as string | null, t: null as string | null };
  const x = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(x.getTime())) return { d: isDate(s.slice(0, 10)) ? s.slice(0, 10) : null, t: null };
  const zone = tz && validTz(tz) ? tz : TZ;
  const local = parts(x, zone);
  if (allDay === 'true' || (allDay !== 'false' && local.t === '00:00')) return { d: local.d, t: null };
  const own = parts(x, TZ);
  return { d: own.d, t: own.t };
};

const iso = (s: string) => {
  if (!s) return null;
  const x = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};

/** Exported reminder triggers (one per line): PT0S, -PT30M, -P1D … → signed minutes relative to the due time. */
export const ttReminders = (s: string) => String(s ?? '').split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean).flatMap((x) => {
  const m = x.replace(/^TRIGGER:/i, '').match(/^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return [];
  const min = (+(m[2] ?? 0)) * 10080 + (+(m[3] ?? 0)) * 1440 + (+(m[4] ?? 0)) * 60 + (+(m[5] ?? 0)) + Math.floor(+(m[6] ?? 0) / 60);
  return [m[1] ? -min : min];
});

/** Text clean-up: the export uses bare \r for line breaks; attachments are not in the export. */
export const cleanText = (s: string) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/!\[([^\]]*)\]\((?!https?:)([^)\s]+)\)/g, (_m, _alt, p: string) => `(attachment not in the export: ${p.split('/').pop()})`)
  .replace(/[ \t]+\n/g, '\n')
  .trim();

/** Checklist content: "▪done item" / "▫open item" lines. Returns [] when the content has no markers. */
export const checklistItems = (content: string) => cleanText(content).split('\n').map((l) => l.trim())
  .filter((l) => /^[▪▫]/.test(l)).map((l) => ({ title: l.slice(1).trim(), done: l.startsWith('▪') })).filter((i) => i.title);

const SECRET_WORDS = /\b(pass(word|wd)?s?|pwd|mdp|mot de passe|recovery codes?|backup codes?|2fa|otp|secret key|api key|tokens?)\b/i;
const pwLike = (w: string) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(w) && w.length >= 8 && w.length <= 64 && !/^https?:/.test(w) && !/[/\\]/.test(w)
  && [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(w)).length >= 3;
const codeLike = (w: string) => /^[A-Za-z0-9-]{6,}$/.test(w) && /\d/.test(w) && /[A-Za-z]/.test(w);

/**
 * Credentials never go into app.db or the vault (CLAUDE.md data rules). Flags:
 * a title that names a password/code, a title that IS a password, or content with a 2FA secret / "password:" line.
 */
export const redactSecrets = (title: string, content: string) => {
  const t = title.trim();
  const titleIsSecret = !/\s/.test(t) && pwLike(t);
  // A title like "new pass" only matters when there is something to hide: content, or a code in the title itself.
  const titleNamesSecret = SECRET_WORDS.test(t) && !/\b(shall|could|this too) pass\b/i.test(t)
    && (!!content.trim() || t.split(/\s+/).some((w) => pwLike(w) || codeLike(w.replace(/[.,;:]+$/, ''))));
  const contentSecret = /\b([A-Z2-7]{4}\s+){3,}[A-Z2-7]{4}\b/.test(content)
    || /\b(pass(word|wd)?|pwd|mdp|pin|secret key)\s*[:=]\s*\S/i.test(content)
    || /\b(2fa|otp)\b[\s\S]{0,40}\b[A-Z2-7]{16,}\b/i.test(content);
  if (!titleIsSecret && !titleNamesSecret && !contentSecret) return { title: t, content, redacted: false };
  let nt = titleIsSecret ? 'Login (imported)' : t.split(/\s+/).filter((w) => !pwLike(w) && !codeLike(w.replace(/[.,;:]+$/, ''))).join(' ');
  if (!nt) nt = 'Login details';
  return { title: nt, content: IN_APP(nt), redacted: true };
};

/** Stable key per exported row: hash of what the row is, plus a counter for exact duplicates. */
const keyOf = (r: Row) => createHash('sha1').update([r['Folder Name'], r['List Name'], r.Kind, r.Title, r.Content, r['Created Time'],
  r['Due Date'], r['Completed Time'], r.Status].map((x) => String(x ?? '')).join('\u0001')).digest('hex').slice(0, 16);

const safeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
/** CSS/JS pasted into a note: keep it in a code block so Obsidian does not read `#id` as tags or headings. */
export const looksLikeCode = (s: string) => {
  const ls = s.split('\n').filter((l) => l.trim());
  return ls.length >= 3 && ls.filter((l) => /[{};]\s*$|^\s*\/[*/]/.test(l)).length / ls.length >= 0.4;
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// ---------- import ----------

type Opts = { vault?: string; today?: string };

/** Folder names that mean the same app area. */
const AREA_SYNONYMS = [['business', 'work']];

export const importTaskCsv = (csv: string, dryRun = false, o: Opts = {}) => {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const hi = lines.findIndex((l) => /^"?Folder Name"?\s*,/.test(l));
  if (hi < 0) bad('Not a task backup CSV: no "Folder Name" header row');
  const rows = parseCsv(lines.slice(hi).join('\n')).filter((r) => String(r['List Name'] ?? r.Title ?? '').trim() || String(r.Title ?? '').trim());
  const today = o.today ?? lifeToday();
  const vault = o.vault ?? VAULT;
  const tpri = (p: string) => ({ '5': 3, '3': 2, '1': 1 } as Record<string, number>)[p] ?? 0;

  // Keys (with duplicate counters) and per-list order ranks.
  const seenKey = new Map<string, number>();
  const keyed = rows.map((r) => {
    const k = keyOf(r);
    const n = seenKey.get(k) ?? 0;
    seenKey.set(k, n + 1);
    return { r, key: `tt:${k}${n ? `#${n}` : ''}` };
  });
  const rankOf = new Map<Row, number>();
  const byListRows = new Map<string, Row[]>();
  for (const { r } of keyed) { const l = String(r['List Name'] ?? ''); byListRows.set(l, [...(byListRows.get(l) ?? []), r]); }
  for (const rs of byListRows.values()) [...rs].sort((a, b) => (Number(a.Order) || 0) - (Number(b.Order) || 0)).forEach((r, i) => rankOf.set(r, i));

  const rep = {
    rows: rows.length, tasks: 0, checklistItems: 0, notes: 0, skipped: 0, empty: 0, untitledRescued: 0,
    byStatus: { open: 0, done: 0, dropped: 0 }, logins: 0, parked: 0, pastDueCleared: 0, reminders: 0, repeating: 0, subtasks: 0, longTitles: 0,
    areasNew: [] as string[], areasMatched: [] as string[], projectsNew: [] as string[], projectsMatched: [] as string[], projectsArchived: [] as string[],
    vaultFiles: [] as string[], redacted: [] as { list: string; title: string }[], byList: {} as Record<string, { tasks: number; notes: number }>,
    dryRun,
  };

  // Which lists get a project: any list holding at least one task (not only notes). Inbox = no project.
  const isInbox = (l: string) => !l || l.toLowerCase() === 'inbox';
  const listHasTask = new Set(rows.filter((r) => String(r.Kind).toUpperCase() !== 'NOTE').map((r) => String(r['List Name'] ?? '')));
  const listOpen = new Set(rows.filter((r) => String(r.Kind).toUpperCase() !== 'NOTE' && String(r.Status) === '0').map((r) => String(r['List Name'] ?? '')));
  const folderOf = new Map(rows.map((r) => [String(r['List Name'] ?? ''), String(r['Folder Name'] ?? '').trim()]));
  const listOrder = [...new Set(rows.map((r) => String(r['List Name'] ?? '')))];
  const notePath = (list: string) => `Imported/${safeName(folderOf.get(list) || 'No folder')}/${safeName(isInbox(list) ? 'Inbox' : splitEmoji(list).name)}.md`;
  const listHasNote = new Set(rows.filter((r) => String(r.Kind).toUpperCase() === 'NOTE').map((r) => String(r['List Name'] ?? '')));

  const areaIds = new Map<string, string | null>();
  const area = (folder: string) => {
    if (!folder) return null;
    if (areaIds.has(folder)) return areaIds.get(folder)!;
    // Same name first, then a known synonym (exported "Business" = app "Work").
    const names = [folder, ...(AREA_SYNONYMS.find((g) => g.includes(folder.toLowerCase())) ?? [])];
    const found = names.map((n) => one<{ id: string; name: string }>(`SELECT id, name FROM areas WHERE deleted_at IS NULL AND lower(name) = lower(?)`, n)).find(Boolean);
    if (found && found.name.toLowerCase() !== folder.toLowerCase()) rep.areasMatched.push(`${folder} → ${found.name}`);
    let id = found?.id ?? null;
    if (!found) {
      rep.areasNew.push(folder);
      if (!dryRun) { id = uuid(); insert('areas', { id, name: folder, sort: 100 + areaIds.size }); }
    }
    areaIds.set(folder, id);
    return id;
  };
  const projectIds = new Map<string, string | null>();
  const project = (list: string) => {
    if (isInbox(list)) return null;
    if (projectIds.has(list)) return projectIds.get(list)!;
    const { emoji, name } = splitEmoji(list);
    const found = all<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE deleted_at IS NULL`).find((p) => norm(p.name) === norm(name) && norm(name));
    let id = found?.id ?? null;
    if (found) rep.projectsMatched.push(`${list} → ${found.name}`);
    else {
      rep.projectsNew.push(list);
      const archived = !listOpen.has(list);
      if (archived) rep.projectsArchived.push(list);
      if (!dryRun) {
        id = uuid();
        insert('projects', { id, name, emoji, area_id: area(folderOf.get(list) ?? ''), status: archived ? 'archived' : 'active',
          sort: 100 + listOrder.indexOf(list), note_path: listHasNote.has(list) ? notePath(list) : null });
      } else area(folderOf.get(list) ?? '');
    }
    projectIds.set(list, id);
    return id;
  };

  const notesByList = new Map<string, { key: string; section: string; title: string; body: string; created: string | null; done: boolean }[]>();
  const keyToId = new Map<string, string>();       // tt key → app task id
  const rowIdToKey = new Map<string, string>();    // exported taskId (row number) → tt key, for parentId links
  for (const { r, key } of keyed) rowIdToKey.set(String(r.taskId ?? '').trim(), key);

  type Pending = { row: Row; parentKey: string };
  const pending: Pending[] = [];

  const work = () => {
    for (const { r, key } of keyed) {
      const list = String(r['List Name'] ?? '').trim();
      const kind = String(r.Kind ?? '').toUpperCase();
      const status = String(r.Status ?? '0');
      const st = status === '0' ? 'open' : status === '-1' ? 'dropped' : 'done';
      const section = String(r['Column Name'] ?? '').trim();
      const sec = section && section !== 'Not Sectioned' ? section : null;
      let title = cleanText(String(r.Title ?? '')).replace(/\n+/g, ' ');
      let content = cleanText(String(r.Content ?? ''));
      const s = redactSecrets(title, content);
      // Logins and codes: the safe title shows in lists; the full original sits in the task notes (private app DB), tag `login`.
      let secret = '';
      if (s.redacted) {
        rep.redacted.push({ list: list || 'Inbox', title: s.title });
        secret = [s.title !== title ? title : '', content].filter(Boolean).join('\n\n');
        title = s.title; content = s.content;
      }
      if (!title) {
        if (!content) { rep.empty++; continue; }
        const first = content.split('\n').find((l) => l.trim())!.replace(/^[#>*\-\s]+/, '').trim();
        title = first.startsWith('(attachment not in') ? 'Imported image (file not in the export)' : first.slice(0, 120);
        rep.untitledRescued++;
      }
      const bl = (rep.byList[list || 'Inbox'] ??= { tasks: 0, notes: 0 });

      if (kind === 'NOTE') {
        rep.notes++; bl.notes++;
        const arr = notesByList.get(list) ?? [];
        arr.push({ key, section: sec ?? '', title, body: content, created: iso(String(r['Created Time'] ?? '')), done: st !== 'open' });
        notesByList.set(list, arr);
        if (secret && !one(`SELECT 1 FROM tasks WHERE legacy_import_id = ?`, `${key}/note`)) {
          rep.logins++;
          if (!dryRun) insert('tasks', { id: uuid(), title, notes: secret, project_id: listHasTask.has(list) ? project(list) : null, status: 'open',
            priority: 0, tags: ['login'], someday: true, source: 'csv-import', legacy_import_id: `${key}/note` });
        }
        continue;
      }

      const existing = one<{ id: string }>(`SELECT id FROM tasks WHERE legacy_import_id = ?`, key);
      if (existing) { keyToId.set(key, existing.id); rep.skipped++; continue; }
      rep.tasks++; bl.tasks++;
      rep.byStatus[st]++;

      let notes = secret || content;
      if (secret) rep.logins++;
      if (title.length > 300) {
        rep.longTitles++;
        notes = [title, content].filter(Boolean).join('\n\n');
        title = `${title.slice(0, 296).replace(/\s+\S*$/, '')} …`;
      }
      const tz = String(r.Timezone ?? '');
      const allDay = String(r['Is All Day'] ?? '');
      const due = ttDate(String(r['Due Date'] ?? ''), tz, allDay);
      const start = ttDate(String(r['Start Date'] ?? ''), tz, allDay);
      let dueDate = due.d, dueTime = due.t;
      // Old exported dates must not land in "Needs a day": no nagging about things from another system.
      if (st === 'open' && dueDate && dueDate < today) {
        rep.pastDueCleared++;
        notes = [notes, `Was due ${dueDate}${dueTime ? ` ${dueTime}` : ''} in the old app.`].filter(Boolean).join('\n\n');
        dueDate = null; dueTime = null;
      }
      // Open tasks without a current date are parked in Someday, so What now / Today stay as they are.
      const someday = st === 'open' && !dueDate;
      if (someday) rep.parked++;
      const recur = r.Repeat ? fromRRule(String(r.Repeat)) : null;
      if (recur) rep.repeating++;
      const tags = String(r.Tags ?? '').split(/[,\s]+/).map((x) => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
      const created = iso(String(r['Created Time'] ?? ''));
      const doneAt = st === 'open' ? null : (iso(String(r['Completed Time'] ?? '')) ?? created ?? now());
      const items = kind === 'CHECKLIST' || String(r['Is Check list']) === 'Y' ? checklistItems(String(r.Content ?? '')) : [];
      if (items.length) notes = notes.split('\n').filter((l) => !/^[▪▫]/.test(l.trim())).join('\n').trim();
      const id = uuid();
      keyToId.set(key, id);
      const row: Row = {
        id, title, notes, project_id: dryRun ? null : project(list), section: sec, status: st, done_at: doneAt,
        priority: tpri(String(r.Priority ?? '0')), tags: secret ? [...new Set([...tags, 'login'])] : tags, due_date: dueDate, due_time: dueTime,
        start_date: start.d && dueDate && start.d < dueDate && start.d >= today ? start.d : null,
        recur, someday, source: 'csv-import', legacy_import_id: key, sort: rankOf.get(r) ?? 0,
        ...(created ? { created_at: created } : {}),
      };
      if (dryRun) project(list);
      const parentKey = rowIdToKey.get(String(r.parentId ?? '').trim()) ?? '';
      if (parentKey) { rep.subtasks++; pending.push({ row, parentKey }); }
      else if (!dryRun) insert('tasks', row);

      items.forEach((it, i) => {
        rep.checklistItems++;
        if (dryRun) return;
        const ck = `${key}/${i}`;
        if (one(`SELECT 1 FROM tasks WHERE legacy_import_id = ?`, ck)) return;
        const ist = it.done || st !== 'open' ? (st === 'dropped' && !it.done ? 'dropped' : 'done') : 'open';
        pending.push({ parentKey: key, row: { id: uuid(), title: it.title.slice(0, 300), notes: '', project_id: row.project_id, status: ist,
          done_at: ist === 'open' ? null : doneAt, priority: 0, tags: [], someday: false, source: 'csv-import', legacy_import_id: ck, sort: i,
          ...(created ? { created_at: created } : {}) } });
      });

      // Reminders only for open tasks with a current date; past ones are stored as already sent.
      const offs = st === 'open' && dueDate ? ttReminders(String(r.Reminder ?? '')) : [];
      for (const off of offs) {
        rep.reminders++;
        if (dryRun || !dueDate) continue;
        const base = zonedMs(dueDate, dueTime ?? '09:00');
        const at = new Date(base + off * 60000).toISOString();
        insert('reminders', { id: uuid(), task_id: id, at, anchor: 'due', offset_min: off, sent_at: at < now() ? now() : null });
      }
    }
    if (dryRun) return;
    // Parents first: a subtask whose parent is itself a subtask waits until that parent is in.
    const inDb = (id: string) => !!one(`SELECT 1 FROM tasks WHERE id = ?`, id);
    for (let guard = pending.length; pending.length && guard >= 0; guard--) {
      for (let i = 0; i < pending.length; i++) {
        const p = keyToId.get(pending[i].parentKey);
        if (!p || inDb(p)) { insert('tasks', { ...pending[i].row, parent_id: p ?? null }); pending.splice(i--, 1); }
      }
    }
    for (const { row } of pending) insert('tasks', row); // cycle in the export: keep the task, drop the link
    // Projects that only got done tasks stay out of the sidebar (archived); a new open task revives them in the app.
    for (const [list, id] of projectIds) if (id && listOpen.has(list)) {
      const p = one<{ status: string }>(`SELECT status FROM projects WHERE id = ?`, id);
      if (p?.status === 'archived' && rep.projectsNew.includes(list)) patch('projects', id, { status: 'active' });
    }
  };

  if (dryRun) work();
  else {
    // All or nothing: a bad row rolls back the whole database part, so a retry starts clean.
    db().exec('BEGIN IMMEDIATE');
    try { work(); db().exec('COMMIT'); } catch (e) { db().exec('ROLLBACK'); throw e; }
  }

  // NOTE items → one Markdown file per list in the vault. Existing files are only appended to (missing notes).
  for (const [list, notes] of notesByList) {
    const rel = notePath(list);
    const abs = join(vault, ...rel.split('/'));
    const have = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const fresh = notes.filter((n) => !have.includes(`<!-- ${n.key} -->`));
    if (!fresh.length) continue;
    rep.vaultFiles.push(`${rel} (+${fresh.length})`);
    if (dryRun) continue;
    const { emoji, name } = splitEmoji(isInbox(list) ? 'Inbox' : list);
    const out: string[] = [];
    if (!have) out.push('---', `title: "${name.replace(/"/g, "'")}"`, 'source: csv-import', `imported: ${today}`, '---', '', `# ${emoji ? `${emoji} ` : ''}${name}`, '',
      `Imported (${folderOf.get(list) || 'no folder'}). One entry per imported note.`, '');
    else out.push('', `## Added from import ${today}`, '');
    let lastSec: string | null = null;
    const sorted = [...notes].filter((n) => fresh.includes(n)).sort((a, b) => a.section.localeCompare(b.section));
    for (const n of sorted) {
      if (n.section !== lastSec && n.section) out.push(`## ${n.section}`, '');
      lastSec = n.section;
      const date = n.created ? ` · ${n.created.slice(0, 10)}` : '';
      if (!n.body) out.push(`- ${n.title}${date ? ` <small>(${n.created!.slice(0, 10)})</small>` : ''} <!-- ${n.key} -->`);
      else out.push(`### ${n.title.length > 120 ? `${n.title.slice(0, 117)}…` : n.title}`, `<!-- ${n.key} -->`,
        ...(n.title.length > 120 ? ['', n.title] : []), `*${n.done ? 'Done in the old app' : 'Imported note'}${date}*`, '', looksLikeCode(n.body) ? `~~~\n${n.body}\n~~~` : n.body, '');
    }
    mkdirSync(dirname(abs), { recursive: true });
    if (have) appendFileSync(abs, `${out.join('\n')}\n`, 'utf8'); else writeFileSync(abs, `${out.join('\n')}\n`, 'utf8');
  }
  return rep;
};
