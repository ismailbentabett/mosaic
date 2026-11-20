import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-money-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_TZ = 'UTC';
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const m = await import('../src/modules/money/store.ts');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };

test('accounts, rates, records, refunds, transfers excluded from spend', () => {
  assert.ok(m.seedCategories() > 20);
  assert.equal(m.seedCategories(), 0);
  m.setRate('EUR', 1.25, '2026-11-01');
  const cash = m.addAccount({ name: 'Cash', currency: 'EUR', opening_balance: 800 });
  const usd = m.addAccount({ name: 'Bank', type: 'bank', currency: 'USD', opening_balance: 500 });
  m.addAccount({ name: 'Studio', currency: 'USD', track: 'business', opening_balance: 300 });
  assert.equal(code(() => m.addAccount({ name: 'cash' })), 'bad_request');
  assert.equal(code(() => m.addAccount({ name: 'Card 1234 5678 9012 3456' })), 'bad_request');

  const r = m.addRecord({ id: 'record-0001', amount: 12, category: 'Groceries', day: '2026-11-03', note: 'market' });
  assert.equal(r.usd, 15);
  assert.equal(r.rate_estimated, true); // rate from 11-01 reused on 11-03
  assert.equal(m.addRecord({ id: 'record-0001', amount: 9 }).amount, 12); // idempotent
  m.addRecord({ amount: 2.4, kind: 'income', category: 'Food & Drinks/Groceries', day: '2026-11-04', note: 'refund' });
  m.addRecord({ amount: 50, account: 'Bank', category: 'Software/Claude', day: '2026-11-05' });
  m.addRecord({ amount: 20, account: 'Studio', category: 'Software/Domains', day: '2026-11-05' });
  m.transfer({ from: 'Bank', to: 'Cash', amount: 100, day: '2026-11-06' });
  assert.equal(code(() => m.addRecord({ amount: 0 })), 'bad_request');
  assert.equal(code(() => m.addRecord({ amount: 5, currency: 'GBP' })), 'bad_request');

  const s = m.summary({ from: '2026-11-01', to: '2026-11-30' });
  assert.equal(s.spend_usd, 15 - 3 + 50);
  assert.equal(s.income_usd, 0);
  assert.equal(s.by_category.find((c) => c.name === 'Food & Drinks')?.usd, 12);
  assert.equal(m.summary({ from: '2026-11-01', to: '2026-11-30' }, 'business').spend_usd, 20);

  assert.equal(m.balance(usd.id), 500 - 50 - 100);
  assert.equal(m.balance(cash.id), Math.round((800 - 12 + 2.4 + 80) * 100) / 100);
  const tid = m.listRecords({ account: 'Cash' }).find((x) => x.transfer_id)!;
  m.deleteRecord(String(tid.id));
  assert.equal(m.balance(usd.id), 450);
});

test('quick log line', () => {
  const r = m.quickLog('3 groceries #family', { day: '2026-11-10' });
  assert.equal(r.amount, 3);
  assert.equal(r.category_name, 'Groceries');
  assert.deepEqual(r.labels, ['family']);
  const inc = m.quickLog('+50 usd salary');
  assert.equal(inc.kind, 'income');
  assert.equal(inc.account_name, 'Bank');
  assert.equal(code(() => m.quickLog('coffee')), 'bad_request');
  const late = m.quickLog('coffee 4 eur', { day: '2026-11-10' });
  assert.equal(late.amount, 4);
  assert.equal(late.note, 'coffee');
  assert.equal(m.quickLog('eur 18 taxi home', { day: '2026-11-10' }).note, 'taxi home');
  // Structured log: the note is never parsed for an amount; currency picks the account; category guessed from the note.
  const s = m.logRecord({ amount: 3, currency: 'EUR', kind: 'expense', note: '2 groceries 5000', day: '2026-11-10' });
  assert.equal(s.amount, 3);
  assert.equal(s.currency, 'EUR');
  assert.equal(s.note, '2 groceries 5000');
  assert.equal(s.category_name, 'Groceries');
  const su = m.logRecord({ amount: 40, currency: 'USD', kind: 'income', note: 'salary' });
  assert.equal(su.account_name, 'Bank');
  assert.equal(code(() => m.logRecord({ amount: 5, currency: 'GBP' })), 'bad_request');
  m.deleteRecord(s.id); // keep later totals unchanged
  m.deleteRecord(su.id);
  // Shorthands people actually type: "eur"/"euros", "$", "€".
  const eu = m.quickLog('8 eur taxi', { day: '2026-11-10' });
  assert.equal(eu.amount, 8);
  assert.equal(eu.currency, 'EUR');
  assert.equal(eu.note, 'taxi');
  assert.equal(m.quickLog('3 euros bread', { day: '2026-11-10' }).note, 'bread');
  assert.equal(m.quickLog('800 dates', { day: '2026-11-10' }).note, 'dates');
  const usd = m.quickLog('+$50 salary', { day: '2026-11-10' });
  assert.equal(usd.kind, 'income');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.amount, 50);
  const later = m.quickLog('domain $12', { day: '2026-11-10' });
  assert.equal(later.currency, 'USD');
  assert.equal(later.note, 'domain');
  // Never join digits across spaces; thousands separators and k/m.
  const cases: [string, number][] = [
    ['1.500 groceries', 1500], ['1,500 groceries', 1500], ['2.5 usd tip', 2.5],
    ['2k rent', 2000], ['2K rent', 2000], ['1m car', 1000000],
  ];
  const made = [m.quickLog('300 2 croissants', { day: '2026-11-10' })];
  assert.equal(made[0].amount, 300);
  assert.equal(made[0].note, '2 croissants');
  for (const [line, amount] of cases) {
    const r = m.quickLog(line, { day: '2026-11-10' });
    made.push(r);
    assert.equal(r.amount, amount, line);
  }
  for (const r of made) m.deleteRecord(String(r.id)); // keep later totals unchanged
});

test('runway, budgets neutral, planned, templates, debts, savings, shopping', () => {
  const rw = m.runway('2026-11-30');
  assert.ok(rw.cash_usd > 0 && rw.weekly_burn_usd > 0 && rw.runway_weeks! > 0);

  m.addBudget({ name: 'Food', period: 'month', amount_usd: 10, categories: ['Food & Drinks'] });
  const b = m.listBudgets('2026-11-15')[0];
  assert.equal(b.spent_usd, 15.75); // 12 + quick-logged 3 EUR groceries
  assert.equal(b.left_usd, -5.75);

  const p = m.addPlanned({ name: 'Claude', template: { amount: 20, account: 'Bank', category: 'Software/Claude' }, recur: { freq: 'monthly', monthday: 28 }, next_due: '2026-11-28', auto_post: true });
  assert.equal(m.runPlanned('2026-12-30'), 2);
  assert.equal(m.listPlanned()[0].next_due, '2027-01-28');
  assert.equal(m.listRecords({ q: '' }).filter((r) => r.planned_id === p.id).length, 2);

  m.addTemplate('Coffee', { amount: 4, category: 'Café', note: 'coffee' });
  assert.equal(m.useTemplate('coffee').amount, 4);

  const d = m.addDebt({ person: 'Karim', direction: 'lent', amount: 50, account: 'Cash', record: true });
  const before = m.summary({ from: '2026-11-01', to: '2026-12-31' }).spend_usd;
  m.repayDebt(String(d.id), 20, 'Cash');
  assert.equal(m.debtState(String(d.id)).left, 30);
  m.repayDebt(String(d.id), 30);
  assert.equal(m.listDebts().length, 0);
  assert.equal(m.summary({ from: '2026-11-01', to: '2026-12-31' }).spend_usd, before);

  m.addSavingsGoal({ name: 'Car fund', target_usd: 8000, target_date: '2027-06-01', account: 'Bank' });
  const g = m.listSavingsGoals('2026-11-30')[0];
  assert.ok(g.monthly_needed_usd! > 0);

  const it = m.addShopping('Milk', 'Groceries', '2');
  m.addShopping('Eggs');
  m.toggleShopping(it.id, true);
  assert.equal(m.listShopping('Groceries').length, 1);
  assert.equal(m.clearDoneShopping(), 1);
});

test('Wallet CSV import is idempotent, maps transfers and refunds', () => {
  const csv = [
    'account;category;currency;amount;ref_currency_amount;type;payment_type;payment_type_local;note;date;gps_latitude;gps_longitude;gps_accuracy_in_meters;warranty_in_month;transfer;payee;labels;envelope_id;custom_category',
    'Wallet Cash;Restaurant;EUR;-12;-13;Expenses;CASH;Cash;lunch;2026-10-20 13:10:00;;;;0;false;Pizzeria;food|out;1000;false',
    'Wallet Cash;Salary;EUR;300;327;Income;CASH;Cash;;2026-10-21 10:00:00;;;;0;false;;;;false',
    'Wallet Cash;Transfer;EUR;-50;-54;Expenses;CASH;Cash;;2026-10-22 10:00:00;;;;0;true;;;;false',
    'Wallet Cash;Electronics;EUR;-200;-218;Expenses;CASH;Cash;phone;2026-10-23 10:00:00;;;;12;false;;;;false',
  ].join('\n');
  assert.deepEqual(m.importWallet(csv, true), { added: 4, skipped: 0, transfers: 1, errors: [], dryRun: true });
  assert.equal(m.importWallet(csv).added, 4);
  assert.equal(m.importWallet(csv).skipped, 4);
  const rows = m.listRecords({ account: 'Wallet Cash' });
  assert.equal(rows.length, 4);
  assert.ok(rows.find((r) => r.note === 'phone')?.warranty_until);
  assert.deepEqual(rows.find((r) => r.note === 'lunch')?.labels, ['food', 'out']);
  const s = m.summary({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(s.estimated_rates, 3); // transfer row not counted in summary
  assert.equal(m.balance('Wallet Cash'), -12 + 300 - 50 - 200);
  assert.equal(code(() => m.importWallet('a;b\n1;2')), 'bad_request');
  assert.ok(m.exportRecords().length > 5);
});

test('kind edits never make refunds, manual rate kept, cross-currency repayment, runway excludes goal and debts, budget and goal edits', () => {
  // expense -> income drops the expense category (otherwise it would read as a refund)
  const e = m.addRecord({ amount: 10, category: 'Groceries', day: '2026-11-10', account: 'Cash' });
  const flipped = m.updateRecord(String(e.id), { kind: 'income' })! as Record<string, any>;
  assert.equal(flipped.kind, 'income');
  assert.equal(flipped.category_id, null);
  assert.equal(flipped.direction, 1);
  // a manual rate survives a day change; a new day alone does not overwrite it
  const manual = m.updateRecord(String(e.id), { rate_to_usd: 1.2 })! as Record<string, any>;
  assert.equal(manual.usd, 12);
  const moved = m.updateRecord(String(e.id), { day: '2026-11-11' })! as Record<string, any>;
  assert.equal(moved.rate_to_usd, 1.2);
  assert.equal(moved.rate_estimated, false);
  assert.equal(m.listRecords({ kind: 'income' }).some((r) => r.id === e.id), true);
  assert.equal(m.listRecords({ kind: 'expense' }).some((r) => r.id === e.id), false);
  assert.equal(code(() => m.listRecords({ kind: 'gift' })), 'bad_request');
  m.deleteRecord(String(e.id));

  // runway: the car-fund account is not living cash
  const lc0 = m.livingCash('2026-11-30');
  assert.ok(lc0.goal_usd > 0); // Bank holds the car fund
  const rw = m.runway('2026-11-30');
  assert.equal(rw.cash_usd, lc0.cash_usd);
  assert.equal(rw.goal_usd, lc0.goal_usd);
  assert.ok(rw.lasts_to === null || /^\d{4}-\d{2}-\d{2}$/.test(rw.lasts_to));

  // borrowed money in USD, repaid from the EUR cash account: booked in EUR, counted in USD
  m.addAccount({ name: 'Wise', currency: 'USD', opening_balance: 0 });
  const d = m.addDebt({ person: 'Sami', direction: 'borrowed', amount: 100, currency: 'USD', account: 'Wise', record: true });
  const lc1 = m.livingCash('2026-11-30');
  assert.equal(lc1.owed_usd, 100);
  assert.equal(lc1.cash_usd, lc0.cash_usd); // +100 on Wise, -100 still owed
  m.repayDebt(String(d.id), 40, 'Cash');
  assert.equal(m.debtState(String(d.id)).left, 60);
  const row = m.listRecords({ kind: 'transfer', account: 'Cash' }).find((r) => r.debt_id === d.id)! as Record<string, any>;
  assert.equal(row.currency, 'EUR');
  assert.equal(row.debt_amount, 40);
  assert.ok(Math.abs(row.amount - 32) < 0.01); // 40 USD in euros at 1.25
  m.repayDebt(String(d.id), 60); // falls back to the debt's own account
  assert.equal(m.listDebts().some((x) => x.id === d.id), false);
  const e2 = m.addDebt({ person: 'Nadia', direction: 'lent', amount: 10, currency: 'GBP' });
  assert.equal(code(() => m.repayDebt(String(e2.id), 5)), 'bad_request'); // no GBP account: ask which account

  // budgets: one weekly budget, edited in place
  const w1 = m.setWeeklyBudget(50)! as Record<string, any>;
  const w2 = m.setWeeklyBudget(70)! as Record<string, any>;
  assert.equal(w1.id, w2.id);
  assert.equal(w2.amount_usd, 70);
  assert.equal((m.updateBudget(String(w2.id), { name: 'Week' })! as Record<string, any>).name, 'Week');
  assert.equal(code(() => m.updateBudget(String(w2.id), { amount_usd: 0 })), 'bad_request');
  m.deleteBudget(String(w2.id));
  assert.equal(m.listBudgets().some((b) => b.id === w2.id), false);
  assert.equal(code(() => m.deleteBudget(String(w2.id))), 'not_found');

  // savings goal edit
  const g = m.listSavingsGoals()[0];
  assert.equal((m.updateSavingsGoal(String(g.id), { target_usd: 9000 })! as Record<string, any>).target_usd, 9000);
  assert.equal(code(() => m.updateSavingsGoal(String(g.id), { target_date: '06/2027' })), 'bad_request');
});
