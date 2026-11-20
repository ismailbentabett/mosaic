import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, parseTitle, blockOf, buildDescription, parseDescription, splitDescription,
  buildSummary, stripSummary, validate, projectFor, leadingEmoji, ifThenLine,
} from '../src/rules.ts';
import type { BlockInput } from '../src/rules.ts';
import { toCalEvent } from '../src/calendar.ts';
import type { CalEvent } from '../src/calendar.ts';

const THU = '2026-11-12';
const SAT = '2026-11-14';
let n = 0;
const ev = (summary: string, o: { date?: string; time?: string; desc?: string; allDay?: boolean } = {}): CalEvent => {
  const date = o.date ?? THU;
  return toCalEvent({
    id: `e${++n}`, summary, description: o.desc,
    start: o.allDay ? { date } : { dateTime: `${date}T${o.time ?? '15:30'}:00Z` },
    end: o.allDay ? { date } : { dateTime: `${date}T16:20:00Z` },
  });
};
const input = (o: Partial<BlockInput> = {}): BlockInput => ({
  event_id: 'x', task: 'Draft 3 pages: project plan', first_action: 'Open the doc', minutes: 50,
  done: '3 pages drafted', must: false, ...o,
});
const titled = (summary: string, must = false) =>
  ev(`${summary} · Some task`, { desc: `IF it is 10:00, THEN go.\n50m. DONE = x.\n${must ? 'PRIORITY' : 'OPTIONAL'}` });
const rejects = (fn: () => void, re: RegExp) =>
  assert.throws(fn, (e: any) => e.code === 'rule_violation' && re.test(e.message));

test('classify kinds', () => {
  assert.equal(classify('Week: ship 3 pages', true).kind, 'helper');
  assert.equal(classify('Plan: notes', true).kind, 'helper');
  assert.equal(classify('D12/30 Launch sprint', true).kind, 'banner');
  assert.equal(classify('D12/30 Launch sprint', false).kind, 'other');
  assert.equal(classify('😴 Sleep', false).kind, 'anchor');
  assert.equal(classify('🏋️ Gym', false).kind, 'anchor');
  assert.equal(classify('🏋 Gym', false).kind, 'anchor');
  assert.equal(classify('Dentist', false).kind, 'other');
  const c = classify('🧠 Deep work · Draft 3 pages', false);
  assert.deepEqual(c, { kind: 'block', blockName: '🧠 Deep work', emoji: '🧠' });
});

test('FE0F and no-FE0F variants of Project work match', () => {
  assert.equal(blockOf('🛠️ Project work'), '🛠️ Project work');
  assert.equal(blockOf('🛠 Project work'), '🛠️ Project work');
  assert.equal(classify('🛠 Project work · Build page', false).blockName, '🛠️ Project work');
  assert.equal(leadingEmoji('🛠️ Project work'), '🛠️');
  assert.equal(blockOf('🗓️ Review'), '🗓️ Weekly review');
  assert.equal(blockOf('🗓 Weekly review'), '🗓️ Weekly review');
});

test('Deep workx does not match Deep work', () => {
  assert.equal(blockOf('🧠 Deep workx'), null);
  assert.equal(classify('🧠 Deep workx', false).kind, 'other');
  assert.equal(blockOf('🧠 Deep work (US)'), '🧠 Deep work');
  assert.equal(blockOf('🛠️ Project workx'), null);
  // Real calendar: colour circles instead of the icon emojis.
  assert.equal(blockOf('🔵 Deep work: replies + follow-ups (Anti-Blue)'), '🧠 Deep work');
  assert.equal(blockOf('🔴 Kickoff (Red Light & Anti-Blue)'), '🚀 Kickoff');
  assert.equal(blockOf('🟠 Admin (Orange Glasses)'), '🗂️ Admin');
  assert.equal(blockOf('🔵 Weekly review (Anti-Blue)'), '🗓️ Weekly review');
  assert.equal(blockOf('⚪️ Sleep (rest)'), null);
  assert.equal(blockOf('Kickoff call with Sam'), null);
});

test('title parse, build, undo', () => {
  assert.deepEqual(parseTitle('🧠 Deep work'), { baseTitle: '🧠 Deep work', task: null });
  assert.deepEqual(parseTitle('🧠 Deep work · Draft 3 pages'), { baseTitle: '🧠 Deep work', task: 'Draft 3 pages' });
  assert.equal(buildSummary('🧠 Deep work', 'Draft 3 pages'), '🧠 Deep work · Draft 3 pages');
  assert.equal(buildSummary('🧠 Deep work · old', 'new'), '🧠 Deep work · new');
  assert.equal(stripSummary('🧠 Deep work · Draft 3 pages: project plan'), '🧠 Deep work');
  assert.equal(stripSummary('🧠 Deep work'), '🧠 Deep work');
});

test('description build is idempotent and keeps original text', () => {
  const a = { first_action: 'Open the doc.', minutes: 50, done: '3 pages drafted.', must: true };
  const d1 = buildDescription('Zoom link: abc\nsecond line', '15:30', a);
  assert.equal(d1, 'IF it is 15:30, THEN Open the doc.\n50m. DONE = 3 pages drafted.\nPRIORITY\n\nZoom link: abc\nsecond line');
  const d2 = buildDescription(d1, '15:30', a);
  assert.equal(d2, d1);
  const d3 = buildDescription(d1, '15:30', { ...a, must: false, minutes: 30 });
  assert.match(d3, /^IF it is 15:30, THEN Open the doc\.\n30m\. DONE = 3 pages drafted\.\nOPTIONAL\n\nZoom link: abc/);
  assert.equal(buildDescription('', '09:00', a), 'IF it is 09:00, THEN Open the doc.\n50m. DONE = 3 pages drafted.\nPRIORITY');
  assert.equal(splitDescription(d1).rest, 'Zoom link: abc\nsecond line');
  assert.equal(splitDescription('Just notes').rest, 'Just notes');
  const p = parseDescription(d1);
  assert.equal(p.minutes, 50);
  assert.equal(p.done, '3 pages drafted');
  assert.equal(p.must, true);
  assert.equal(p.ifThen, 'IF it is 15:30, THEN Open the doc.');
  assert.equal(parseDescription('IF it is 15:30, THEN go.<br>20m. DONE = ok.<br>OPTIONAL').minutes, 20);
});

test('toCalEvent: must is null when untitled', () => {
  const e = ev('🧠 Deep work', { desc: 'IF it is 10:00, THEN go.\n50m. DONE = x.\nPRIORITY' });
  assert.equal(e.must, null);
  assert.equal(titled('🧠 Deep work', true).must, true);
});

test('rejects non-block events', () => {
  rejects(() => validate(ev('D3/30 Sprint', { allDay: true }), [], input(), 'Normal'), /banner/);
  rejects(() => validate(ev('😴 Sleep'), [], input(), 'Normal'), /anchor/);
  rejects(() => validate(ev('Plan: x', { allDay: true }), [], input(), 'Normal'), /helper/);
  rejects(() => validate(ev('Dentist'), [], input(), 'Normal'), /other/);
});

test('task length and fields', () => {
  const b = ev('🧠 Deep work');
  rejects(() => validate(b, [], input({ task: 'x'.repeat(45) }), 'Normal'), /under 45/);
  assert.doesNotThrow(() => validate(b, [], input({ task: 'x'.repeat(44) }), 'Normal'));
  rejects(() => validate(b, [], input({ task: 'a\nb' }), 'Normal'), /one line/);
  rejects(() => validate(b, [], input({ task: 'a · b' }), 'Normal'), /·/);
  rejects(() => validate(b, [], input({ first_action: '' }), 'Normal'), /first_action/);
  rejects(() => validate(b, [], input({ minutes: 4 }), 'Normal'), /minutes/);
  rejects(() => validate(b, [], input({ minutes: 12.5 }), 'Normal'), /minutes/);
  rejects(() => validate(b, [], input({ done: ' ' }), 'Normal'), /done/);
});

test('priority rules', () => {
  rejects(() => validate(ev('🧹 Buffer'), [], input({ must: true }), 'Normal'), /Priority is only/);
  assert.doesNotThrow(() => validate(ev('🛠️ Project work'), [], input({ must: true }), 'Normal'));
  const day = [titled('🧠 Deep work', true), titled('📞 Meetings', true), titled('🛠️ Project work', true)];
  const target = ev('🛠 Project work');
  rejects(() => validate(target, day, input({ must: true }), 'Normal'), /4th/);
  // re-titling one of the 3 priority blocks is fine (it excludes itself)
  assert.doesNotThrow(() => validate(day[0], day, input({ must: true }), 'Normal'));
});

test('Saturday is rest day', () => {
  rejects(() => validate(ev('🧠 Deep work', { date: SAT }), [], input(), 'Normal'), /Saturday/);
});

test('max 6 titled blocks, Kickoff not counted', () => {
  const six = ['🗂️ Admin', '🛠️ Project work', '🧠 Deep work', '📞 Meetings', '📚 Learning', '🧹 Buffer']
    .map((b) => titled(b));
  const extra = ev('🗓️ Weekly review');
  rejects(() => validate(extra, six, input(), 'Normal'), /7th/);
  assert.doesNotThrow(() => validate(ev('🚀 Kickoff'), six, input(), 'Normal'));
  assert.doesNotThrow(() => validate(extra, [...six.slice(1), titled('🚀 Kickoff')], input(), 'Normal'));
});

test('Zero and Family modes', () => {
  const one = [titled('🧠 Deep work')];
  rejects(() => validate(ev('📞 Meetings'), one, input({ minutes: 10 }), 'Zero'), /Zero mode: only one/);
  rejects(() => validate(ev('📞 Meetings'), [], input({ minutes: 11 }), 'Zero'), /10 minutes/);
  assert.doesNotThrow(() => validate(ev('📞 Meetings'), [], input({ minutes: 10 }), 'Zero'));
  rejects(() => validate(ev('📞 Meetings'), one, input(), 'Family'), /Family/);
  assert.doesNotThrow(() => validate(ev('📞 Meetings'), [], input(), 'Family'));
});

test('project mapping', () => {
  assert.equal(projectFor('🗂️ Admin', 'Send 2 invoices'), 'Admin');
  assert.equal(projectFor('📚 Learning', 'Course lesson 4'), 'Learning');
  assert.equal(projectFor('📚 Learning', 'Pay invoice'), 'Admin');
  assert.equal(projectFor('🧠 Deep work', 'Draft 3 pages'), 'Work');
  assert.equal(projectFor('🗓️ Weekly review', 'Weekly review'), 'Personal');
  assert.equal(projectFor('🚀 Kickoff', 'Open first priority'), null);
  assert.equal(projectFor('🧠 Deep work', 'x', 'Inbox'), 'Inbox');
});

test('if-then line: plain and older labelled forms both parse', () => {
  const plain = parseDescription('IF it is 15:30, THEN go.\n50m. DONE = x.\nPRIORITY');
  assert.equal(plain.minutes, 50);
  const anchored = 'IF it is after Lunch (15:30), THEN Open the doc.\n50m. DONE = 3 pages drafted.\nPRIORITY\n\nnotes';
  const p = parseDescription(anchored);
  assert.equal(p.minutes, 50);
  assert.equal(p.must, true);
  assert.equal(splitDescription(anchored).rest, 'notes');
  // Rebuilding over a labelled description keeps the user's notes once.
  const a = { first_action: 'Open the doc', minutes: 50, done: '3 pages drafted', must: true };
  assert.equal(buildDescription(anchored, '15:30', a), 'IF it is 15:30, THEN Open the doc.\n50m. DONE = 3 pages drafted.\nPRIORITY\n\nnotes');
  assert.equal(ifThenLine('15:30', 'go'), 'IF it is 15:30, THEN go.');
  assert.equal(ifThenLine('03:00', 'go'), 'IF it is 03:00, THEN go.');
});

test('Zero and Family: Kickoff counts toward the one block', () => {
  rejects(() => validate(ev('🧠 Deep work'), [titled('🚀 Kickoff')], input({ minutes: 10 }), 'Zero'), /Zero mode: only one/);
  rejects(() => validate(ev('🚀 Kickoff'), [titled('🧠 Deep work')], input({ minutes: 10 }), 'Zero'), /Zero mode: only one/);
  rejects(() => validate(ev('🚀 Kickoff'), [titled('🧠 Deep work')], input(), 'Family'), /Family/);
  assert.doesNotThrow(() => validate(ev('🚀 Kickoff'), [], input({ minutes: 10 }), 'Zero'));
});
