import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-lifeseed-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
mkdirSync(join(root, 'vault'), { recursive: true });
const { importLife } = await import('../src/modules/lifeseed.ts');
const g = await import('../src/modules/grades/store.ts');
const profile = await import('../src/modules/profile/store.ts');
const { all, one, run } = await import('../src/modules/util.ts');
const seed = JSON.parse(readFileSync(new URL('../data/demo-seed.json', import.meta.url), 'utf8'));
const TODAY = '2026-11-11';

test('seed file holds no secrets and no contact data', () => {
  const s = JSON.stringify(seed);
  assert.ok(!/password|api[_ ]key|\btoken\b|\biban\b|card number/i.test(s));
  assert.ok(!/@|https?:\/\/|\+\d[\d ]{7,}|\b0\d(?: ?\d\d){4}\b/.test(s)); // no emails, links or phone numbers
  assert.equal(seed.facts.find((f: { key: string }) => f.key === 'who.name').value, 'Sam');
});

test('dry run writes nothing', () => {
  const r = importLife(seed, true, TODAY);
  assert.equal(r.dryRun, true);
  assert.ok(r.goals.added >= 8);
  assert.equal(one<{ n: number }>(`SELECT COUNT(*) AS n FROM goals WHERE seed_key LIKE 'life:%'`)!.n, 0);
});

test('first run fills the app', () => {
  const r = importLife(seed, false, TODAY);
  assert.deepEqual(r.errors, []);
  assert.equal(r.goals.added, seed.goals.length);
  assert.ok(r.facts.added > 30);
  assert.ok(r.habits.added >= 8);
  assert.ok(r.milestones.added >= 10);
  assert.ok(r.links.added >= 6);
  assert.equal(r.occasions.added, seed.occasions.length);
  assert.ok(g.goalsTree(TODAY).count >= 8);
  const admin = g.listAreas().find((a) => a.name === 'Admin');
  assert.ok(admin, 'Admin area added');
  const body = g.listAreas().find((a) => a.key === 'body');
  assert.match(String(body!.vision), /Gym three evenings/);
});

test('second run is a no-op', () => {
  const before = all(`SELECT id FROM goals WHERE deleted_at IS NULL`).length;
  const r = importLife(seed, false, TODAY);
  assert.equal(r.goals.added, 0);
  assert.equal(r.habits.added, 0);
  assert.equal(r.projects.added, 0);
  assert.equal(r.milestones.added, 0);
  assert.equal(r.links.added, 0);
  assert.equal(r.occasions.added, 0);
  assert.equal(r.people.added, 0);
  assert.equal(r.savings_goals.added, 0);
  assert.equal(all(`SELECT id FROM goals WHERE deleted_at IS NULL`).length, before);
});

test('user answers and edited visions are never overwritten', () => {
  run(`UPDATE profile_facts SET value = ?, source = 'user', confidence = 1 WHERE key = 'who.city'`, JSON.stringify('Leeds'));
  g.updateArea('body', { vision: 'My own words' });
  importLife(seed, false, TODAY);
  assert.equal(g.listAreas().find((a) => a.key === 'body')!.vision, 'My own words');
  const f = profile.profileGet('who.city')[0];
  assert.equal(f.value, 'Leeds');
  assert.equal(f.source, 'user');
});

test('bad seed version is refused', () => {
  assert.throws(() => importLife({ version: 2 } as never, true, TODAY));
});
