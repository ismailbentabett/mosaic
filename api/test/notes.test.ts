import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-notes-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault', 'Projects', 'Studio'), { recursive: true });
writeFileSync(join(root, 'vault', 'Home.md'), '# Home\nWelcome to the vault.\n');
writeFileSync(join(root, 'vault', 'Projects', 'Studio', 'README.md'), '# Studio\nBakeries in London.\n');

const n = await import('../src/notes.ts');
const { today } = await import('../src/time.ts');
const code = async (fn: () => unknown) => { try { await fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('resolveVaultPath rejects unsafe paths', async () => {
  for (const bad of ['', '../x.md', 'a/../../x.md', '/etc/passwd.md', 'C:/x.md', '\\x.md', 'a\\b.md', 'x.txt', '.obsidian/a.md', 'a/.git/b.md', 'x\0.md', '.md'])
    assert.equal(await code(() => n.resolveVaultPath(bad)), 'bad_request', JSON.stringify(bad));
  assert.ok(n.resolveVaultPath('Log/new/deep.md').endsWith('deep.md'));
});

test('symlink out of the vault is rejected', async (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'mosaic-out-'));
  try { symlinkSync(outside, join(root, 'vault', 'escape'), 'junction'); } catch { return t.skip('no symlink permission'); }
  assert.equal(await code(() => n.resolveVaultPath('escape/x.md')), 'bad_request');
});

test('write / read / conflict', async () => {
  const w = await n.writeNote('Areas/a.md', '# A\none', null);
  const r = await n.readNote('Areas/a.md');
  assert.equal(r.content, '# A\none');
  assert.equal(r.mtime, w.mtime);
  await assert.rejects(n.writeNote('Areas/a.md', 'x', w.mtime - 5000), (e: any) => e.code === 'conflict' && e.extra.content === '# A\none');
  await n.writeNote('Areas/a.md', '# A\ntwo', w.mtime);
  assert.equal((await n.readNote('Areas/a.md')).content, '# A\ntwo');
  assert.ok(!readdirSync(join(root, 'vault', 'Areas')).some((f) => f.endsWith('.tmp')));
  assert.equal(await code(() => n.readNote('nope.md')), 'not_found');
});

test('append adds today heading once', async () => {
  writeFileSync(join(root, 'vault', 'Inbox.md'), '# Inbox\n\n## 2020-01-01 old\n- x');
  await n.appendNote('Inbox.md', 'first');
  await n.appendNote('Inbox.md', 'second');
  const c = readFileSync(join(root, 'vault', 'Inbox.md'), 'utf8');
  assert.equal(c, `# Inbox\n\n## 2020-01-01 old\n- x\n\n## ${today()}\nfirst\nsecond\n`);
  await n.appendNote('Fresh.md', 'hello');
  assert.equal(readFileSync(join(root, 'vault', 'Fresh.md'), 'utf8'), `# Fresh\n\n## ${today()}\nhello\n`);
});

test('capture writes a timed line to today log', async () => {
  const { path } = await n.captureNote('call\ndentist back');
  assert.equal(path, `Log/${today()}.md`);
  const c = readFileSync(join(root, 'vault', 'Log', `${today()}.md`), 'utf8');
  assert.match(c, new RegExp(`^# ${today()}\\n\\n- \\d{2}:\\d{2} call dentist back\\n$`));
});

test('recent and search', async () => {
  const r = await n.recentNotes();
  assert.ok(r.notes.length >= 3);
  assert.deepEqual(r.pinned.map((p) => p.path), ['Home.md', 'Inbox.md', 'Projects/Studio/README.md']);
  assert.equal(r.today.exists, true);
  const s = await n.searchNotes('london');
  assert.equal(s[0].path, 'Projects/Studio/README.md');
  assert.equal(s[0].line, 2);
  const byName = await n.searchNotes('home');
  assert.equal(byName[0].line, 0);
  assert.equal(await code(() => n.searchNotes('')), 'bad_request');
});

test('conflicts: list and resolve moves file out', async () => {
  writeFileSync(join(root, 'vault', 'Areas', 'c.md'), 'orig');
  const cname = 'Areas/c.sync-conflict-20261111-101010-ABCDEFG.md';
  writeFileSync(join(root, 'vault', ...cname.split('/')), 'theirs');
  const list = await n.listConflicts();
  assert.deepEqual(list, [{ conflict: cname, original: 'Areas/c.md', conflictContent: 'theirs', originalContent: 'orig' }]);
  await n.resolveConflict(cname, 'keep_conflict');
  assert.equal(readFileSync(join(root, 'vault', 'Areas', 'c.md'), 'utf8'), 'theirs');
  assert.ok(!existsSync(join(root, 'vault', ...cname.split('/'))));
  assert.ok(readdirSync(join(root, 'data', 'resolved')).some((f) => f.endsWith('Areas__c.sync-conflict-20261111-101010-ABCDEFG.md')));
  assert.equal(await code(() => n.resolveConflict('Areas/c.md', 'keep_original')), 'bad_request');
});
