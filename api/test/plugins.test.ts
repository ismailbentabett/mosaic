import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-plugins-'));
const pluginsDir = join(root, 'plugins');
mkdirSync(pluginsDir);
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_PLUGINS_DIR = pluginsDir;

// The shipped example, plus two broken plugins that must be reported and skipped.
cpSync(resolve(import.meta.dirname, '../../examples/plugins/reading-log'), join(pluginsDir, 'reading-log'), { recursive: true });
writeFileSync(join(pluginsDir, 'bad-table.mjs'), `export default { name: 'sneaky', version: '1', migrations: [{ version: 1, sql: 'CREATE TABLE tasks (x)' }] };`);
writeFileSync(join(pluginsDir, 'bad-name.mjs'), `export default { name: 'Bad Name', version: '1' };`);
writeFileSync(join(pluginsDir, 'notes.txt'), 'ignored');

const P = await import('../src/plugins/index.ts');
const { getDb } = await import('../src/db.ts');
const { Hono } = await import('hono');

test('migration guard: only p_<name>_ objects, no PRAGMA/ATTACH', () => {
  assert.doesNotThrow(() => P.checkMigrationSql('demo', 'CREATE TABLE IF NOT EXISTS p_demo_x (a); CREATE INDEX p_demo_i ON p_demo_x (a);'));
  assert.throws(() => P.checkMigrationSql('demo', 'CREATE TABLE tasks (a)'), /must be named p_demo_/);
  assert.throws(() => P.checkMigrationSql('demo', 'DROP TABLE IF EXISTS "money_records"'), /must be named p_demo_/);
  assert.throws(() => P.checkMigrationSql('demo', 'ALTER TABLE habits ADD COLUMN x'), /must be named p_demo_/);
  assert.throws(() => P.checkMigrationSql('demo', 'PRAGMA writable_schema = 1'), /not allowed/);
});

test('loadPlugins loads the example, reports broken ones, and survives a second call', async () => {
  const first = await P.loadPlugins();
  assert.deepEqual(first.map((p) => p.plugin.name), ['reading']);
  const failed = P.pluginFailures();
  assert.equal(failed.length, 2);
  assert.ok(failed.some((f) => /must be named p_sneaky_/.test(f.error)));
  assert.ok(failed.some((f) => /name must match/.test(f.error)));
  const tables = getDb().prepare("SELECT name FROM sqlite_master WHERE name LIKE 'tasks' OR name LIKE 'p_sneaky%'").all();
  assert.equal(tables.filter((t) => (t as { name: string }).name.startsWith('p_sneaky')).length, 0, 'rejected plugin left nothing behind');

  const again = await P.loadPlugins();
  assert.equal(again.length, 1, 'idempotent');
  const applied = getDb().prepare("SELECT version FROM plugin_migrations WHERE plugin = 'reading' ORDER BY version").all() as { version: number }[];
  assert.deepEqual(applied.map((r) => r.version), [1, 2]);
});

test('routes are mounted under /plugins/<name>/ and the index lists them', async () => {
  const app = new Hono().route('/api/v2/plugins', P.pluginsRouter());
  const idx = await (await app.request('/api/v2/plugins')).json();
  assert.equal(idx.api, P.PLUGIN_API_VERSION);
  assert.deepEqual(idx.plugins[0].tools, ['reading_add', 'reading_list']);

  const created = await app.request('/api/v2/plugins/reading/books', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A Field Guide to Clouds', author: 'R. Vale' }),
  });
  assert.equal(created.status, 201);
  const book = await created.json();
  assert.equal(book.title, 'A Field Guide to Clouds');

  assert.equal((await app.request('/api/v2/plugins/reading/books', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await app.request(`/api/v2/plugins/reading/books/${book.id}/finish`, { method: 'POST' })).status, 200);
  assert.equal((await app.request(`/api/v2/plugins/reading/books/${book.id}/finish`, { method: 'POST' })).status, 404);
  const open = await (await app.request('/api/v2/plugins/reading/books?open=1')).json();
  assert.equal(open.books.length, 0);
  const res = await app.request('/api/v2/plugins/nope/books');
  assert.notEqual(res.status, 200);
});

test('tools are namespaced, take the server zod, and run against the plugin context', async () => {
  const tools = P.pluginTools();
  assert.deepEqual(tools.map((t) => t.name), ['reading_add', 'reading_list']);
  const add = tools.find((t) => t.name === 'reading_add')!;
  assert.ok(add.description.startsWith('[reading] '));
  assert.ok('title' in add.shape);
  const book = (await add.run({ title: 'Small Gods of the Kitchen' })) as { id: number };
  assert.ok(book.id > 0);
  const listed = (await tools.find((t) => t.name === 'reading_list')!.run({ open: true })) as { books: unknown[] };
  assert.equal(listed.books.length, 1);
});

test('registerPlugin rejects duplicates, bad tools and API mismatches', () => {
  assert.throws(() => P.registerPlugin({ name: 'reading', version: '2' }), /loaded twice/);
  assert.throws(() => P.registerPlugin({ name: 'future', version: '1', api: 99 }), /API 99/);
  assert.throws(() => P.registerPlugin({ name: 'tooly', version: '1', tools: { 'Bad-Name': { description: 'x', input: {}, run: () => 1 } } }), /tool name/);
  assert.throws(() => P.registerPlugin({ name: 'dupe', version: '1', migrations: [{ version: 1, sql: '' }, { version: 1, sql: '' }] }), /duplicate migration/);
  const ctx = P.registerPlugin({ name: 'settings_demo', version: '1' }).ctx;
  ctx.settings.set('k', 'v1');
  ctx.settings.set('k', 'v2');
  assert.equal(ctx.settings.get('k'), 'v2');
  assert.equal(ctx.settings.get('missing'), null);
  assert.equal(ctx.table('x'), 'p_settings_demo_x');
  assert.throws(() => ctx.table('x; DROP TABLE tasks'), /bad table name/);
});
