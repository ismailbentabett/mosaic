import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-imports-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const imp = await import('../src/modules/imports.ts');
const tasks = await import('../src/modules/tasks/store.ts');
const money = await import('../src/modules/money/store.ts');
const { all } = await import('../src/modules/util.ts');
money.seedCategories();

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

const TODOIST = [
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE',
  'section,Kitchen,,,,,,,,',
  'task,Descale the kettle @home,Use citric acid,1,1,,,2026-12-01,en,UTC',
  'note,Two spoons per litre,,,,,,,,',
  'task,Buy citric acid @errands,,4,2,,,,,',
  'section,Garden,,,,,,,,',
  'task,Water the herbs,,2,1,,,every monday,en,UTC',
  'task,,,4,1,,,,,',
].join('\n');

test('todoist: sections, subtasks, labels, notes, priority, dates', () => {
  const dry = imp.importTodoist(TODOIST, { project: 'Home', dryRun: true });
  assert.deepEqual([dry.created, dry.skipped, dry.dryRun], [3, 0, true]);
  assert.equal(all(`SELECT id FROM tasks WHERE source = 'import-todoist'`).length, 0);

  const r = imp.importTodoist(TODOIST, { project: 'Home' });
  assert.equal(r.created, 3);
  assert.equal(r.errors.length, 1); // the empty task row
  const rows = all(`SELECT * FROM tasks WHERE source = 'import-todoist' ORDER BY title`) as any[];
  const kettle = rows.find((t) => t.title === 'Descale the kettle');
  const acid = rows.find((t) => t.title === 'Buy citric acid');
  const herbs = rows.find((t) => t.title === 'Water the herbs');
  assert.ok(kettle && acid && herbs);
  assert.equal(kettle.section, 'Kitchen');
  assert.equal(kettle.priority, 3);
  assert.equal(kettle.due_date, '2026-12-01');
  assert.match(kettle.notes, /citric acid/);
  assert.match(kettle.notes, /Two spoons/);
  assert.match(String(kettle.tags), /home/);
  assert.equal(acid.parent_id, kettle.id);
  assert.equal(acid.priority, 0);
  assert.equal(herbs.section, 'Garden');
  assert.equal(herbs.due_date, null);
  assert.match(herbs.notes, /every monday/);

  const again = imp.importTodoist(TODOIST, { project: 'Home' });
  assert.deepEqual([again.created, again.skipped], [0, 3]);
});

test('todoist: rejects files that are not Todoist exports', () => {
  assert.equal(code(() => imp.importTodoist('a,b\n1,2')), 'bad_request');
  assert.equal(code(() => imp.importTodoist('')), 'bad_request');
  assert.ok(tasks.getTask); // module loaded
});

test('parseMoney handles US, EU, parentheses and junk', () => {
  assert.equal(imp.parseMoney('$1,234.56'), 1234.56);
  assert.equal(imp.parseMoney('1.234,56 €'), 1234.56);
  assert.equal(imp.parseMoney('(12.00)'), -12);
  assert.equal(imp.parseMoney('-3'), -3);
  assert.equal(imp.parseMoney(''), 0);
  assert.ok(Number.isNaN(imp.parseMoney('abc')));
});

test('date order: day-first detected per file, ISO passes through', () => {
  const { toIso, dateOrder } = imp._internals;
  assert.equal(dateOrder(['03/04/2026', '25/04/2026']), 'dmy');
  assert.equal(dateOrder(['03/04/2026', '04/25/2026']), 'mdy');
  assert.equal(toIso('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(toIso('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(toIso('2026-04-03', 'mdy'), '2026-04-03');
  assert.equal(toIso('13/13/2026', 'mdy'), null);
});

const YNAB = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Checking","","11/02/2026","Corner Grocer","Everyday Expenses: Groceries","Everyday Expenses","Groceries","","$42.10","$0.00","Cleared"',
  '"Checking","","11/02/2026","Corner Grocer","Everyday Expenses: Groceries","Everyday Expenses","Groceries","","$42.10","$0.00","Cleared"',
  '"Checking","","11/03/2026","Transfer : Savings","","","","","$100.00","$0.00","Cleared"',
  '"Savings","","11/03/2026","Transfer : Checking","","","","","$0.00","$100.00","Cleared"',
  '"Checking","","11/01/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","Pay","$0.00","$2,500.00","Cleared"',
  '"Checking","","11/04/2026","Nobody","","","","","$0.00","$0.00","Cleared"',
  '"Checking","","not a date","Shop","","","","","$5.00","$0.00","Cleared"',
].join('\n');

test('ynab: transfers skipped, duplicates kept, idempotent, dry run writes nothing', () => {
  const dry = imp.importYnab(YNAB, { dryRun: true });
  assert.deepEqual([dry.created, dry.transfers, dry.dryRun], [3, 2, true]);
  assert.equal(all(`SELECT id FROM records WHERE import_ref LIKE 'ynab:%'`).length, 0);

  const r = imp.importYnab(YNAB);
  assert.equal(r.created, 3);
  assert.equal(r.transfers, 2);
  assert.equal(r.skipped, 1); // zero amount
  assert.equal(r.errors.length, 1); // bad date
  const recs = all(`SELECT * FROM records WHERE import_ref LIKE 'ynab:%' ORDER BY day`) as any[];
  assert.equal(recs.length, 3);
  const income = recs.find((x) => x.kind === 'income');
  assert.equal(income.amount, 2500);
  assert.equal(income.category_id, null);
  const groceries = recs.filter((x) => x.kind === 'expense');
  assert.equal(groceries.length, 2);
  assert.equal(groceries[0].amount, 42.1);
  assert.equal(groceries[0].currency, 'USD');
  assert.ok(money.getAccount('Checking'));

  const again = imp.importYnab(YNAB);
  assert.equal(again.created, 0);
  assert.equal(all(`SELECT id FROM records WHERE import_ref LIKE 'ynab:%'`).length, 3);
});

test('ynab: validation', () => {
  assert.equal(code(() => imp.importYnab('Date,Payee\n2026-01-01,x')), 'bad_request');
  assert.equal(code(() => imp.importYnab(YNAB, { currency: 'dollars' })), 'bad_request');
  const csv = 'Account;Date;Payee;Category;Outflow;Inflow\nWallet;25/10/2026;Bakery;Food;3,50;0';
  const r = imp.importYnab(csv, { currency: 'EUR' });
  assert.equal(r.created, 1);
  const rec = all(`SELECT * FROM records WHERE payee = 'Bakery'`)[0] as any;
  assert.equal(rec.day, '2026-10-25');
  assert.equal(rec.amount, 3.5);
  assert.equal(rec.currency, 'EUR');
});

test('importCsv routes by source', () => {
  const r = imp.importCsv('todoist', 'TYPE,CONTENT,PRIORITY,INDENT\ntask,Read a chapter,4,1', { dryRun: true });
  assert.equal(r.created, 1);
});
