// Bad input must be a 400 or 404, never a 500. Each case below was a 500 before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'mosaic-edge-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
process.env.MOSAIC_SECRETS = join(root, 'secrets.env');
process.env.MOSAIC_ACTION_KEY = 'test-action-key-0123456789abcdef';
process.env.MOSAIC_DEV = '1'; // dev mode: no sign-in
mkdirSync(join(root, 'vault'), { recursive: true });
const { buildApp } = await import('../src/routes.ts');
const app = buildApp();

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.fetch(new Request('http://localhost:8787' + path, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  }));
  return { status: res.status, body: await res.json().catch(() => null) as { error?: string } | null };
};

test('impossible or malformed day query params are a 400', async () => {
  for (const path of ['/api/v2/tasks/counts', '/api/v2/done/month', '/api/v2/money/runway', '/api/v2/body', '/api/v2/habits',
    '/api/v2/grades/quarter', '/api/v2/areas/quiet', '/api/v2/screentime', '/api/v2/food/tdee']) {
    for (const day of ['nope', '2026-02-30', '2026-13-01']) {
      const r = await call('GET', `${path}?day=${day}`);
      assert.equal(r.status, 400, `${path}?day=${day}`);
      assert.equal(r.body?.error, 'bad_request');
    }
  }
  assert.equal((await call('GET', '/api/v2/gym/volume?week=x')).status, 400);
  assert.equal((await call('GET', '/api/v2/tasks/counts?day=2026-11-20')).status, 200);
});

test('a project body with unknown or mistyped fields is a 400, known fields still work', async () => {
  assert.equal((await call('POST', '/api/v2/projects', { name: 'X', title: [] })).status, 201); // unknown keys are ignored
  assert.equal((await call('POST', '/api/v2/projects', { name: 'Y', status: 1 })).status, 400);
  assert.equal((await call('POST', '/api/v2/projects', { name: 'Y', sort: 'x' })).status, 400);
  const ok = await call('POST', '/api/v2/projects', { name: 'Portfolio', emoji: '🎨', status: 'paused' });
  assert.equal(ok.status, 201);
  assert.equal((ok.body as unknown as { status: string }).status, 'paused');
});

test('money rates and transfers reject missing or mistyped fields', async () => {
  assert.equal((await call('POST', '/api/v2/money/rates', {})).status, 400);
  assert.equal((await call('POST', '/api/v2/money/rates', { currency: 'EUR', to_usd: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/v2/money/rates', { currency: 'EUR', to_usd: 1.08 })).status, 200);
  assert.equal((await call('POST', '/api/v2/money/transfer', {})).status, 400);
  assert.equal((await call('POST', '/api/v2/money/transfer', { from: 5, to: 6, amount: 1 })).status, 400);
  assert.equal((await call('POST', '/api/v2/money/transfer', { from: 'nope', to: 'other', amount: 1 })).status, 404);
});

test('food recipes and meal copies reject bad shapes', async () => {
  assert.equal((await call('POST', '/api/v2/food/recipes', { name: 'Soup', items: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/v2/food/recipes', { name: 'Soup', items: [null] })).status, 400);
  assert.equal((await call('POST', '/api/v2/food/copy-meal', {})).status, 400);
  assert.equal((await call('POST', '/api/v2/food/copy-meal', { from_day: '2026-02-30' })).status, 400);
  assert.equal((await call('POST', '/api/v2/food/copy-meal', { from_day: '2026-11-19', to_day: '2026-11-20' })).status, 201);
});

test('routine items: unknown routine is a 404, a bad list is a 400', async () => {
  assert.equal((await call('PUT', '/api/v2/gym/routines/nope/items', { items: [] })).status, 404);
  const r = await call('POST', '/api/v2/gym/routines', { name: 'Push', items: [] });
  assert.equal(r.status, 201);
  const id = (r.body as unknown as { id: string }).id;
  assert.equal((await call('PUT', `/api/v2/gym/routines/${id}/items`, { items: 'x' })).status, 400);
  assert.equal((await call('PUT', `/api/v2/gym/routines/${id}/items`, { items: [null] })).status, 400);
  assert.equal((await call('PUT', `/api/v2/gym/routines/${id}/items`, { items: [] })).status, 200);
});

test('malformed JSON bodies are a 400', async () => {
  assert.equal((await call('POST', '/api/v2/projects', '{not json')).status, 400);
  assert.equal((await call('POST', '/api/v2/money/transfer', '[1,2]')).status, 400);
});
