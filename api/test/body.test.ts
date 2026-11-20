import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-body-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const u = await import('../src/modules/util.ts');
const fact = (key: string, value: unknown) => u.run('INSERT INTO profile_facts (key, value, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value), 'test', u.now());
const b = await import('../src/modules/body/store.ts');

test('metrics validate, convert units, idempotent ids', () => {
  const w = b.logMetric({ id: 'metric-0001', day: '2026-11-01', kind: 'weight', value: 176.4, unit: 'lb' });
  assert.equal(w.value, 80.01);
  assert.equal(b.logMetric({ id: 'metric-0001', day: '2026-11-01', kind: 'weight', value: 99 }).value, 80.01);
  assert.equal(b.logMetric({ day: '2026-11-01', kind: 'waist', value: 34, unit: 'in' }).value, 86.36);
  assert.equal(code(() => b.logMetric({ kind: 'weight', value: 10 })), 'bad_request');
  assert.equal(code(() => b.logMetric({ kind: 'mood', value: 5 })), 'bad_request');
  assert.equal(code(() => b.logMetric({ kind: 'weight', value: 80, day: '11/01' })), 'bad_request');
});

test('trend carries over gaps and smooths', () => {
  b.logMetric({ day: '2026-11-03', kind: 'weight', value: 79 });
  b.logMetric({ day: '2026-11-03', kind: 'weight', value: 81 }); // same-day mean = 80
  const tr = b.trend('2026-11-05');
  assert.equal(tr.length, 5);
  assert.equal(tr[0].trend, 80.01);
  assert.equal(tr[4].trend, tr[2].trend); // no weigh-in on 04/05 → carried
  assert.deepEqual(b.trend('2026-10-01'), []);
  const s = b.bodySummary('2026-11-05');
  assert.equal(s.last_weight?.kg, 80);
  assert.equal(s.weigh_ins_21d, 2);
  assert.ok(s.latest.waist);
  assert.equal(s.avg_7d, 80); // 80.01 and 80 in the last 7 days
  assert.equal(s.avg_prev_7d, null);
  assert.equal(b.bodySummary('2026-11-09').avg_prev_7d, 80); // 11-01 only, one decimal
});

test('estimate asks for missing profile facts, never guesses', () => {
  const e = b.estimateFromProfile('2026-11-05');
  assert.equal(e.bmr, null);
  assert.deepEqual(e.missing, ['body.sex', 'body.height_cm', 'body.birth_year']);
  fact('body.sex', 'male'); fact('body.height_cm', 180); fact('body.birth_year', 1996); fact('body.activity', 'moderate');
  const e2 = b.estimateFromProfile('2026-11-05');
  assert.equal(e2.bmr, b.mifflin({ sex: 'male', weight_kg: e2.weight_kg!, height_cm: 180, age: 30 }));
  assert.equal(e2.tdee, Math.round(e2.bmr! * 1.55));
  assert.equal(b.mifflin({ sex: 'female', weight_kg: 60, height_cm: 165, age: 30 }), 1320);
});
