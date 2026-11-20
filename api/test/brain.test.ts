import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-brain-'));
const vault = join(root, 'vault');
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = vault;
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(vault, 'Projects'), { recursive: true });
mkdirSync(join(vault, '.obsidian'), { recursive: true });

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const p = await import('../src/modules/profile/store.ts');
const br = await import('../src/modules/brain/store.ts');
const { lifeSnapshot } = await import('../src/modules/life.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const body = await import('../src/modules/body/store.ts');

test('asks: seeded once, ordered, answer validates, skip returns later', () => {
  const first = p.asksNext(1, '2026-11-11');
  assert.equal(first[0].key, 'body.sex');
  assert.equal(p.seedAsks(), 0); // already seeded
  assert.equal(code(() => p.asksAnswer('body.sex', 'robot')), 'bad_request');
  assert.deepEqual(p.asksAnswer('body.sex', 'Male'), { key: 'body.sex', value: 'male' });
  assert.equal(code(() => p.asksAnswer('body.height_cm', 400)), 'bad_request');
  p.asksAnswer('body.height_cm', '178');
  assert.equal(p.asksNext(1, '2026-11-11')[0].key, 'body.birth_year');
  const sk = p.asksSkip('body.birth_year', 7, '2026-11-11');
  assert.equal(sk.skip_until, '2026-11-18');
  assert.notEqual(p.asksNext(1, '2026-11-12')[0].key, 'body.birth_year');
  assert.ok(p.asksNext(20, '2026-11-18').some((a) => a.key === 'body.birth_year'));
  p.addAsk({ key: 'test.yes_no', module: 'test', question: 'Yes or no?', why: '', answer_type: 'yes_no' });
  assert.equal(p.asksAnswer('test.yes_no', 'no').value, false);
  assert.equal(code(() => p.asksAnswer('nope.key', 1)), 'not_found');
});

test('asks: retired keys are gone, skip 0 = never, confidence asks bounded 1–5, hardestWindow', () => {
  for (const k of p.RETIRED_ASKS) assert.ok(!p.SEED.some((s) => s.key === k), k);
  const never = p.asksSkip('focus.reminder_style', 0, '2026-11-11');
  assert.equal(never.skip_until, '9999-12-31');
  assert.ok(!p.asksNext(20, '2030-01-01').some((a) => a.key === 'focus.reminder_style'));
  p.addAsk({ key: 'goals.confidence.g1', module: 'goals', question: 'How sure?', why: '', answer_type: 'number' });
  assert.equal(code(() => p.asksAnswer('goals.confidence.g1', 9)), 'bad_request');
  assert.equal(code(() => p.asksAnswer('goals.confidence.g1', 0)), 'bad_request');
  assert.equal(p.asksAnswer('goals.confidence.g1', 4).value, 4);
  assert.equal(p.hardestWindow(), null);
  p.asksAnswer('focus.hardest_time', 'evening');
  assert.deepEqual(p.hardestWindow(), { slot: 'evening', from: '17:30', to: '22:30' });
  assert.equal(p.wakeTime(), '07:30');
});

test('profile facts: get by prefix, proposals never beat your answer', () => {
  assert.equal(p.profileGet('body.').length, 2);
  assert.equal(p.profileGet('body.')[0].value, 178);
  assert.equal(p.profilePropose('body.sex', 'female').stored, false);
  assert.equal(code(() => p.profilePropose('body.sex', 'x', 'user')), 'bad_request');
  assert.equal(p.profilePropose('body.activity', 'light', 'claude', 0.5).stored, true);
  assert.equal(code(() => p.profilePropose('body.activity', 'flying', 'claude', 0.9)), 'bad_request');
  assert.equal(p.profilePropose('body.activity', 'high', 'claude', 0.4).stored, false); // lower confidence
  assert.equal(p.profilePropose('life.city', 'Leeds').stored, true);
  // a proposed (not answered) fact still gets asked
  assert.ok(p.asksNext(20, '2026-11-11').some((a) => a.key === 'body.activity'));
  const a = p.addAsk({ key: 'life.car_model', module: 'life', question: 'Which Peugeot year?', why: 'Car fund target.', answer_type: 'text' });
  assert.equal(a.status, 'open');
  assert.equal(code(() => p.addAsk({ key: 'bad key', module: 'x', question: 'q', why: '', answer_type: 'text' })), 'bad_request');
});

test('vault scan: index, links, backlinks, skip binary/large/.obsidian, conflicts, deletes', () => {
  writeFileSync(join(vault, 'Car fund.md'), '# Car fund\nTarget: used Peugeot 208 before summer.\n');
  writeFileSync(join(vault, 'Projects', 'Studio.md'), '---\ntitle: Studio plan\n---\nSee [[Car fund]] and [[Missing note|alias]] and [[car fund#Target]].\n');
  writeFileSync(join(vault, 'Car fund.sync-conflict-20261110-101010-ABCDEFG.md'), '# Car fund\nOther copy.\n');
  writeFileSync(join(vault, '.obsidian', 'workspace.md'), '# hidden\n');
  writeFileSync(join(vault, 'bin.md'), Buffer.from([0x23, 0x00, 0x41]));
  writeFileSync(join(vault, 'big.md'), 'x'.repeat(1024 * 1024 + 1));
  const r = br.scanVault();
  assert.equal(r.indexed, 3);
  assert.equal(r.skipped, 2);
  assert.equal(br.scanVault().indexed, 0); // unchanged files are not re-read

  assert.equal(br.titleOf('Projects/Studio.md', '---\ntitle: Studio plan\n---\nx'), 'Studio plan');
  assert.deepEqual(br.linksOf('[[A]] [[b|x]] [[A#h]] [[c^id]]').sort(), ['a', 'b', 'c']);

  const bl = br.backlinks('Car fund.md');
  assert.deepEqual(bl.inbound.map((x) => x.path), ['Projects/Studio.md']);
  const out = br.backlinks('Projects/Studio.md').outbound;
  assert.equal(out.find((o) => o.name === 'car fund')?.exists, true);
  assert.equal(out.find((o) => o.name === 'missing note')?.exists, false);

  const hits = br.searchNotesIndex('Peugeot');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'Car fund.md');
  assert.ok(hits[0].snippet!.includes('«Peugeot»'));
  assert.ok(br.searchNotesIndex('20').length >= 1); // short query → LIKE
  assert.equal(br.searchNotesIndex('Other copy')[0].conflict, true);
  assert.equal(br.searchNotesIndex('"quoted').length, 0); // quotes never break FTS

  unlinkSync(join(vault, 'Car fund.sync-conflict-20261110-101010-ABCDEFG.md'));
  assert.equal(br.scanVault().removed, 1);
  assert.equal(br.searchNotesIndex('Other copy').length, 0);
});

test('brainSearch spans notes and tasks; snapshot never throws', () => {
  tasks.addTask({ title: 'Ask dealer about Peugeot price' });
  const s = br.brainSearch('peugeot');
  assert.equal(s.results.note?.length, 1);
  assert.equal(s.results.task?.length, 1);
  assert.equal(br.brainSearch('').total, 0);
  assert.equal(code(() => br.brainSearch('x'.repeat(201))), 'bad_request');
  assert.deepEqual(Object.keys(br.brainSearch('peugeot', { kinds: ['task'] }).results), ['task']);

  body.logMetric({ day: '2026-11-11', kind: 'weight', value: 80 });
  const snap = lifeSnapshot('2026-11-11');
  assert.equal(snap.day, '2026-11-11');
  assert.equal(snap.mode, 'Normal');
  for (const k of ['tasks', 'habits', 'goals', 'money', 'food', 'gym', 'body', 'asks_open'] as const) {
    assert.ok(!(snap[k] as any)?.error, `${k} errored: ${(snap[k] as any)?.error}`);
  }
  assert.equal((snap.body as any).last_weight.kg, 80);
  assert.ok((snap.asks_open as any[]).length > 0);
});
