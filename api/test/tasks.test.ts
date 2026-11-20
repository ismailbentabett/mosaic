import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-tasks-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const time = await import('../src/time.ts');
const { getDb } = await import('../src/db.ts');
const { MIGRATIONS, pendingMigrations } = await import('../src/migrate.ts');
const { nextOccurrence, fromRRule, describeRecur } = await import('../src/modules/tasks/recur.ts');
const { parseQuickAdd } = await import('../src/modules/tasks/parse.ts');
const s = await import('../src/modules/tasks/store.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('migrations apply once and all versions recorded', () => {
  const db = getDb();
  assert.equal(pendingMigrations(db).length, 0);
  const v = db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number };
  assert.equal(v.v, MIGRATIONS[MIGRATIONS.length - 1].version);
});

test('lifeDay rolls at 04:00 local time', () => {
  assert.equal(time.lifeDay(new Date('2026-11-11T02:30:00Z')), '2026-11-10');
  assert.equal(time.lifeDay(new Date('2026-11-11T04:00:00Z')), '2026-11-11');
  assert.equal(time.weekStartOf('2026-11-15'), '2026-11-09');
});

test('recurrence: month-end, collapse, count, until, nth, rrule', () => {
  assert.equal(nextOccurrence({ freq: 'monthly', monthday: 31 }, '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence({ freq: 'daily' }, '2026-11-01', '2026-11-11', '2026-11-11'), '2026-11-11');
  assert.equal(nextOccurrence({ freq: 'daily', from: 'completion' }, '2026-11-01', '2026-11-11'), '2026-11-12');
  assert.equal(nextOccurrence({ freq: 'weekly', byday: [1, 3] }, '2026-11-09', '2026-11-09'), '2026-11-11');
  assert.equal(nextOccurrence({ freq: 'daily', count: 2, done_count: 1 }, '2026-11-11', '2026-11-11'), null);
  assert.equal(nextOccurrence({ freq: 'daily', until: '2026-11-11' }, '2026-11-11', '2026-11-11'), null);
  assert.equal(nextOccurrence({ freq: 'monthly', nth: { n: -1, dow: 5 } }, '2026-11-27', '2026-11-27'), '2026-12-25');
  assert.deepEqual(fromRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'), { freq: 'weekly', interval: 2, byday: [1, 5] });
  assert.equal(describeRecur({ freq: 'weekly', byday: [1, 2, 3, 4, 5] }), 'every weekday');
});

test('quick add parser', () => {
  const p = parseQuickAdd('send invoice fri 3pm #admin !1 ~20m ^Studio', '2026-11-11');
  assert.equal(p.title, 'send invoice');
  assert.equal(p.due_date, '2026-11-13');
  assert.equal(p.due_time, '15:00');
  assert.deepEqual(p.tags, ['admin']);
  assert.equal(p.priority, 3);
  assert.equal(p.est_minutes, 20);
  assert.equal(p.project, 'Studio');
  const r = parseQuickAdd('call mom every mon after lunch', '2026-11-11');
  assert.equal(r.title, 'call mom');
  assert.deepEqual(r.recur, { freq: 'weekly', byday: [1] });
  assert.equal(r.due_date, '2026-11-16');
  assert.equal(r.anchor, 'lunch');
  assert.equal(parseQuickAdd('pay rent 1/12', '2026-11-11').due_date, '2026-12-01');
  assert.equal(parseQuickAdd('renew 5 jan', '2026-11-11').due_date, '2027-01-05');
  assert.equal(parseQuickAdd('just a note', '2026-11-11').due_date, undefined);
});

test('task CRUD, idempotent id, views, needs a day', () => {
  const d = '2026-11-11';
  const id = 'aaaaaaaa-0000-0000-0000-000000000001';
  const a = s.addTask({ id, title: 'Write SOP', due_date: d, est_minutes: 30 });
  const again = s.addTask({ id, title: 'different' });
  assert.equal(again.title, 'Write SOP');
  s.addTask({ title: 'Old thing', due_date: '2026-11-01' });
  s.addTask({ title: 'Loose idea' });
  s.addTask({ title: 'Later', start_date: '2026-12-01' });
  assert.deepEqual(s.listTasks({ view: 'today', today: d }).map((t) => t.title), ['Write SOP']);
  assert.deepEqual(s.listTasks({ view: 'needs_day', today: d }).map((t) => t.title), ['Old thing']);
  const inbox = s.listTasks({ view: 'inbox', today: d }).map((t) => t.title);
  assert.ok(inbox.includes('Loose idea') && !inbox.includes('Later'));
  assert.equal(code(() => s.addTask({ title: '  ' })), 'bad_request');
  assert.equal(code(() => s.addTask({ title: 'x', due_date: '11/11' })), 'bad_request');
  assert.equal(code(() => s.addTask({ title: 'x', priority: 5 })), 'bad_request');
  const q = s.quickAdd('buy milk tomorrow #home ^Personal', {}, d);
  assert.equal(q.project_name, 'Personal');
  assert.equal(q.due_date, '2026-11-12');
  assert.equal(s.whatNow(d)?.task.title, 'Write SOP');
  assert.equal(s.capacity(d).planned_minutes, 30);
  s.deleteTask(a.id);
  assert.equal(s.listTasks({ view: 'today', today: d }).length, 0);
  assert.equal(s.listTasks({ view: 'trash', today: d }).length, 1);
  s.restoreTask(a.id);
  assert.equal(s.listTasks({ view: 'today', today: d }).length, 1);
});

test('complete recurring task creates one next occurrence, idempotent', () => {
  const t = s.addTask({ title: 'Weigh in', due_date: '2026-11-01', recur: 'every day' });
  const r = s.completeTask(t.id, '2026-11-11');
  assert.equal(r.task.status, 'done');
  assert.equal(r.next?.due_date, '2026-11-11');
  assert.equal(r.next?.recur?.done_count, 1);
  assert.equal(s.completeTask(t.id, '2026-11-11').next, null);
  const skipped = s.skipOccurrence(r.next!.id, '2026-11-11');
  assert.equal(skipped.due_date, '2026-11-12');
  assert.equal(code(() => s.skipOccurrence(s.addTask({ title: 'once' }).id)), 'bad_request');
});

test('habits and goals', () => {
  s.addHabit('Read 10 pages', 5);
  s.checkHabit('read 10 pages', '2026-11-10');
  s.checkHabit('Read 10 pages', '2026-11-11');
  s.checkHabit('Read 10 pages', '2026-11-11');
  const h = s.listHabits('2026-11-11')[0];
  assert.equal(h.this_week, 2);
  assert.equal(h.today, 1);
  s.checkHabit('Read 10 pages', '2026-11-11', 0);
  assert.equal(s.listHabits('2026-11-11')[0].today, 0);
  const u = s.updateHabit('read 10 pages', { name: 'Read 20 pages', target_per_week: 3 }) as { name: string; target_per_week: number; archived: boolean };
  assert.equal(u.name, 'Read 20 pages');
  assert.equal(u.target_per_week, 3);
  assert.equal(u.archived, false);
  assert.equal(code(() => s.updateHabit('Read 20 pages', { target_per_week: 9 })), 'bad_request');
  assert.equal(code(() => s.updateHabit('Read 20 pages', { name: '  ' })), 'bad_request');
  assert.equal((s.updateHabit('Read 20 pages', { archived: true }) as { archived: boolean }).archived, true);
  s.updateHabit('Read 20 pages', { archived: false });
  const g = s.addGoal({ name: 'Car fund', target_value: 8000, unit: 'USD', target_date: '2027-06-01' }) as { id: string };
  s.setGoalValue(g.id, 1000, '2026-11-11');
  assert.equal(s.listGoals()[0].current, 1000);
});

test('compat shape: uuid id, project title, due with offset', () => {
  const t = s.addTask({ title: 'Renew passport', project: 'Admin', due_date: '2026-11-12', due_time: '11:00', priority: 3 });
  const c = s.compat(t);
  assert.equal(c.id, t.id);
  assert.equal(c.projectTitle, 'Admin');
  assert.equal(Date.parse(String(c.due)), Date.parse('2026-11-12T11:00:00Z'));
  assert.equal(s.resolveRef(t.id).title, 'Renew passport');
  assert.throws(() => s.resolveRef('10'), /not found/);
});

const TTH = '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId","projectKind"';
type TT = Partial<Record<'folder' | 'list' | 'title' | 'kind' | 'tags' | 'content' | 'due' | 'rem' | 'repeat' | 'pri' | 'status' | 'created' | 'completed' | 'order' | 'tz' | 'allDay' | 'section' | 'id' | 'parent', string>>;
const ttRow = (o: TT) => [o.folder ?? '', o.list ?? 'Ideas', o.title ?? '', o.kind ?? 'TEXT', o.tags ?? '', o.content ?? '', o.kind === 'CHECKLIST' ? 'Y' : 'N', '',
  o.due ?? '', o.rem ?? '', o.repeat ?? '', o.pri ?? '0', o.status ?? '0', o.created ?? '', o.completed ?? '', o.order ?? '0', o.tz ?? 'Europe/Paris',
  o.allDay ?? 'true', 'false', o.section ?? '', '', 'list', o.id ?? '', o.parent ?? '', 'TASK'].map((x) => `"${x.replace(/"/g, '""')}"`).join(',');
const tt = (...rows: TT[]) => [TTH, ...rows.map(ttRow)].join('\n');
const ttVault = () => mkdtempSync(join(tmpdir(), 'mosaic-ttv-'));
const allTasks = () => s.listTasks({ view: 'all', includeSubtasks: true });

test('task CSV helpers: dates per time zone, reminders, emoji, checklist, attachments, code', async () => {
  const t = await import('../src/modules/tasks/taskcsv.ts');
  assert.deepEqual(t.ttDate('2026-11-20T05:00:00+0000', 'America/New_York', 'true'), { d: '2026-11-20', t: null });
  assert.deepEqual(t.ttDate('2026-11-11T23:00:00+0000', 'Europe/Paris', 'true'), { d: '2026-11-12', t: null });
  assert.deepEqual(t.ttDate('2026-11-12T14:30:00+0000', 'America/New_York', 'false'), { d: '2026-11-12', t: '14:30' });
  assert.deepEqual(t.ttDate('', 'Europe/Paris', 'true'), { d: null, t: null });
  assert.deepEqual(t.ttReminders('PT0S\n-PT30M\n-P1D\n-PT1H\nnonsense'), [0, -30, -1440, -60]);
  assert.deepEqual(t.splitEmoji('🟠Studio'), { emoji: '🟠', name: 'Studio' });
  assert.deepEqual(t.splitEmoji('Plain'), { emoji: null, name: 'Plain' });
  assert.deepEqual(t.checklistItems('▪Eggs\r▫Milk\rnot an item'), [{ title: 'Eggs', done: true }, { title: 'Milk', done: false }]);
  assert.match(t.cleanText('see ![image](abc123/pic.jpg)\r\nnext'), /^see \(attachment not in the export: pic\.jpg\)\nnext$/);
  assert.ok(t.looksLikeCode('.a{\n  color: red;\n}\n'));
  assert.ok(!t.looksLikeCode('Buy milk\nCall mom\nRead'));
});

test('task CSV logins are detected, normal words are not', async () => {
  const { redactSecrets } = await import('../src/modules/tasks/taskcsv.ts');
  const r = (title: string, content = '') => redactSecrets(title, content);
  assert.equal(r('new pass', 'Xy7!secretA').redacted, true);
  assert.match(r('new pass', 'Xy7!secretA').content, /Kept in the app: task "new pass"/);
  assert.equal(r('Q9w!e8Rt').title, 'Login (imported)');
  assert.equal(r('', 'facebook: me\npassword: hunter22').redacted, true);
  assert.equal(r('This too shall pass').redacted, false);
  assert.equal(r('Change skool credentials').redacted, false);
  assert.equal(r('sam.design2000@example.com').redacted, false);
  assert.equal(r('Deep work', 'Let the urge pass and go outside').redacted, false);
});

test('task CSV import: projects, areas, dates, someday, subtasks, checklist, reminders, re-run', () => {
  const vault = ttVault();
  const today = '2026-11-12';
  const csv = tt(
    { folder: 'Business', list: '🟠Studio', title: 'Draft 3 pages', due: '2026-11-20T05:00:00+0000', tz: 'America/New_York', rem: 'PT0S\n-PT30M', pri: '5', order: '2', section: 'Drafts', created: '2025-01-02T09:00:00+0000', id: '1' },
    { folder: 'Business', list: '🟠Studio', title: 'Old overdue', due: '2026-10-01T23:00:00+0000', rem: 'PT0S', order: '1', id: '2' },
    { folder: 'Business', list: '🟠Studio', title: 'Shipped it', status: '2', completed: '2026-05-01T10:00:00+0000', order: '3', id: '3' },
    { folder: 'Business', list: '🟠Studio', title: 'Step one', id: '4', parent: '1' },
    { folder: 'Business', list: '🟠Studio', title: 'Sub of sub', id: '5', parent: '4' },
    { folder: 'Old', list: '📘Done list', title: 'All done', status: '2', id: '6' },
    { list: 'Inbox', title: 'Grocery List', kind: 'CHECKLIST', content: '▪Eggs\r▫Milk', id: '7' },
    { list: 'Inbox', title: 'Duolingo', due: '2026-11-11T23:00:00+0000', repeat: 'RRULE:FREQ=DAILY;INTERVAL=1', id: '8' },
    { list: 'Inbox', title: '', content: '', id: '9' },
    { list: 'Inbox', title: 'x'.repeat(320), id: '10' },
    { list: 'Inbox', title: 'Twin', id: '11' },
    { list: 'Inbox', title: 'Twin', id: '12' },
  );
  const dry = s.importTaskCsv(csv, true, { vault, today });
  assert.deepEqual([dry.tasks, dry.subtasks, dry.checklistItems, dry.parked, dry.reminders, dry.repeating], [11, 2, 2, 7, 2, 1]);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.empty, 1);
  assert.equal(dry.longTitles, 1);
  assert.equal(dry.pastDueCleared, 1);
  assert.equal(allTasks().filter((t) => t.title === 'Draft 3 pages').length, 0, 'dry run writes nothing');
  s.ensureProject('Studio');
  const r = s.importTaskCsv(csv, false, { vault, today });
  assert.equal(r.tasks, dry.tasks);
  const by = (t: string) => allTasks().find((x) => x.title === t)!;
  const dm = by('Draft 3 pages');
  assert.equal(dm.project_name, 'Studio');
  assert.equal(dm.due_date, '2026-11-20');
  assert.equal(dm.due_time, null);
  assert.equal(dm.priority, 3);
  assert.equal(dm.section, 'Drafts');
  assert.ok(dm.created_at.startsWith('2025-01-02T09:00:00'));
  assert.equal(by('Step one').parent_id, dm.id);
  assert.equal(by('Sub of sub').parent_id, by('Step one').id);
  const old = by('Old overdue');
  assert.equal(old.due_date, null);
  assert.ok(old.someday);
  assert.match(old.notes, /Was due 2026-10-02 in the old app/);
  assert.ok(by('Shipped it').done_at?.startsWith('2026-05-01T10:00:00'));
  assert.equal(by('Shipped it').status, 'done');
  assert.equal(by('Duolingo').due_date, '2026-11-12');
  assert.equal(by('Duolingo').recur?.freq, 'daily');
  assert.equal(by('Duolingo').project_id, null);
  const milk = by('Milk'), eggs = by('Eggs');
  assert.equal(milk.parent_id, by('Grocery List').id);
  assert.deepEqual([milk.status, eggs.status], ['open', 'done']);
  assert.equal(allTasks().filter((t) => t.title === 'Twin').length, 2);
  const long = allTasks().find((t) => t.title.startsWith('xxx'))!;
  assert.ok(long.title.length <= 300 && long.notes.includes('x'.repeat(320)));
  const rem = getDb().prepare('SELECT offset_min FROM reminders WHERE task_id = ? ORDER BY offset_min').all(dm.id) as any[];
  assert.deepEqual(rem.map((x) => x.offset_min), [-30, 0]);
  assert.equal(getDb().prepare('SELECT count(*) n FROM reminders WHERE task_id = ?').get(old.id)!.n, 0);
  const p = getDb().prepare(`SELECT status, emoji FROM projects WHERE name = 'Done list'`).get() as any;
  assert.deepEqual([p.status, p.emoji], ['archived', '📘']);
  assert.ok(getDb().prepare(`SELECT 1 FROM areas WHERE name = 'Old'`).get());
  const work = getDb().prepare(`INSERT INTO areas (id, name, sort, created_at, updated_at) VALUES ('w1', 'Work', 1, '', '') RETURNING id`).get();
  const syn = s.importTaskCsv(tt({ folder: 'BUSINESS', list: 'Errands', title: 'Call Bob', id: '50' }), false, { vault, today });
  assert.deepEqual([syn.areasNew, syn.areasMatched], [[], ['BUSINESS → Work']]);
  assert.equal(getDb().prepare(`SELECT area_id FROM projects WHERE name = 'Errands'`).get()!.area_id, work!.id);
  // re-run with renumbered taskIds adds nothing
  const again = s.importTaskCsv(csv.replace(/"(\d+)","(\d*)","TASK"$/gm, '"9$1","$2","TASK"'), false, { vault, today });
  assert.equal(again.tasks, 0);
  assert.equal(code(() => s.importTaskCsv('a,b\n1,2')), 'bad_request');
});

test('task CSV notes go to the vault, append-only, logins kept in the app', async () => {
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const vault = ttVault();
  const today = '2026-11-12';
  const n1 = { folder: 'PERSONAL', list: '📚Reading', kind: 'NOTE', title: 'Short note', section: 'BOOKS', id: '1' };
  const n2 = { folder: 'PERSONAL', list: '📚Reading', kind: 'NOTE', title: 'Long one', content: 'Line 1\rLine 2', id: '2' };
  const sec = { folder: 'PERSONAL', list: '📚Reading', kind: 'NOTE', title: 'wifi pass', content: 'Zx9!Qw8@Er', id: '3' };
  const dry = s.importTaskCsv(tt(n1, n2, sec), true, { vault, today });
  assert.equal(dry.notes, 3);
  const file = join(vault, 'Imported', 'PERSONAL', 'Reading.md');
  assert.ok(!existsSync(file), 'dry run writes no file');
  const r = s.importTaskCsv(tt(n1, n2, sec), false, { vault, today });
  assert.equal(r.tasks, 0);
  assert.equal(r.redacted.length, 1);
  const md = readFileSync(file, 'utf8');
  assert.ok(md.startsWith('---\n'));
  assert.match(md, /## BOOKS/);
  assert.match(md, /Short note/);
  assert.match(md, /### Long one[\s\S]*Line 1\nLine 2/);
  assert.ok(!md.includes('Zx9!Qw8@Er'));
  assert.ok(md.includes('Kept in the app: task "wifi pass"'));
  const login = allTasks().find((t) => t.title === 'wifi pass')!;
  assert.equal(login.notes, 'Zx9!Qw8@Er');
  assert.deepEqual([login.tags, login.someday, login.project_id], [['login'], true, null]);
  assert.equal(r.logins, 1);
  assert.equal(allTasks().filter((t) => t.title === 'Long one').length, 0, 'notes are not tasks');
  writeFileSync(file, `${md}\nMy own line\n`);
  const n4 = { folder: 'PERSONAL', list: '📚Reading', kind: 'NOTE', title: 'New note', id: '4' };
  const r2 = s.importTaskCsv(tt(n1, n2, sec, n4), false, { vault, today });
  assert.equal(r2.vaultFiles.length, 1);
  const md2 = readFileSync(file, 'utf8');
  assert.ok(md2.startsWith(`${md}\nMy own line\n`), 'existing text untouched');
  assert.match(md2, /## Added from import 2026-11-12[\s\S]*New note/);
  assert.equal(md2.split('Short note').length, 2, 'no duplicate notes');
  assert.equal(s.importTaskCsv(tt(n1, n2, sec, n4), false, { vault, today }).vaultFiles.length, 0);
});

test('task CSV import is all-or-nothing for the database', () => {
  const vault = ttVault();
  const db = getDb();
  db.exec(`CREATE TEMP TRIGGER boom BEFORE INSERT ON tasks WHEN NEW.title = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  const broken = tt({ list: 'Rollback', title: 'Should vanish', id: '1' }, { list: 'Rollback', title: 'BOOM', id: '2' });
  assert.throws(() => s.importTaskCsv(broken, false, { vault, today: '2026-11-12' }));
  db.exec('DROP TRIGGER boom');
  assert.equal(allTasks().filter((t) => t.title === 'Should vanish').length, 0);
  assert.equal(db.prepare(`SELECT count(*) n FROM projects WHERE name = 'Rollback'`).get()!.n, 0);
  assert.equal(s.importTaskCsv(broken, false, { vault, today: '2026-11-12' }).tasks, 2);
});

test('whatNow: current block first, no overdue, no later-today, Zero cap, anchor gap', () => {
  const d = '2027-03-10';
  const at = (t: string) => new Date(`${d}T${t}:00Z`);
  const block = s.addTask({ title: 'Block task', due_date: d, due_time: '15:30', est_minutes: 50, event_id: 'ev-wn-1' });
  s.addTask({ title: 'Later today', due_date: d, due_time: '20:00', est_minutes: 20, priority: 3 });
  s.addTask({ title: 'Short one', due_date: d, est_minutes: 10 });
  s.addTask({ title: 'Long one', due_date: d, est_minutes: 40, priority: 2 });
  s.addTask({ title: 'Overdue one', due_date: '2027-03-01', priority: 3 });

  const inBlock = s.whatNow(d, { at: at('15:40'), mode: 'Normal' })!;
  assert.equal(inBlock.task.id, block.id);
  assert.equal(inBlock.reason, 'block');
  assert.equal(inBlock.minutes, 40);
  assert.equal(s.whatNow(d, { at: at('15:40'), mode: 'Zero' })!.minutes, 10);

  const pick = s.whatNow(d, { at: at('14:00'), mode: 'Normal' })!;
  assert.equal(pick.task.title, 'Long one');
  assert.equal(pick.minutes, 40);
  assert.equal(pick.reason, 'pick');
  const zero = s.whatNow(d, { at: at('14:00'), mode: 'Zero' })!;
  assert.equal(zero.task.title, 'Short one');
  assert.equal(zero.minutes, 10);
  for (const t of ['14:00', '15:40', '21:00']) assert.notEqual(s.whatNow(d, { at: at(t), mode: 'Normal' })?.task.title, 'Overdue one');

  s.setAnchorSource(() => 15); // next anchor in 15 minutes: pick something that fits
  assert.equal(s.whatNow(d, { at: at('14:00'), mode: 'Normal' })!.task.title, 'Short one');
  s.setAnchorSource(null);
});

test('skipTask: one-off moves to tomorrow with prev_due; recurring skips the occurrence', () => {
  const d = '2027-03-11';
  const one = s.addTask({ title: 'Skip me', due_date: d });
  const r = s.skipTask(one.id, d);
  assert.equal(r.due_date, '2027-03-12');
  assert.equal(r.prev_due, d);
  s.updateTask(one.id, { due_date: r.prev_due }); // undo
  assert.equal(s.getTask(one.id)!.due_date, d);
  const rec = s.addTask({ title: 'Daily skip', due_date: d, recur: 'every day' });
  assert.equal(s.skipTask(rec.id, d).due_date, '2027-03-12');
});

test('doneThisMonth counts tasks done this life-month', () => {
  const day = time.lifeToday();
  const before = s.doneThisMonth(day).tasks;
  const t = s.addTask({ title: 'Receipt me' });
  s.completeTask(t.id, day);
  const after = s.doneThisMonth(day);
  assert.equal(after.tasks, before + 1);
  assert.equal(after.month, day.slice(0, 7));
});
