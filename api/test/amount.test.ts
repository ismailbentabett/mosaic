import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAmount, parseNumber } from '../src/modules/money/amount.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('one parser: the web copy is identical to the API copy', () => {
  const api = readFileSync(join(here, '../src/modules/money/amount.ts'), 'utf8').replace(/\r\n/g, '\n');
  const web = readFileSync(join(here, '../../web/src/features/money/amount.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(web, api, 'copy api/src/modules/money/amount.ts to web/src/features/money/amount.ts');
});

test('numbers: separators, decimals, k and m', () => {
  assert.equal(parseNumber('1500'), 1500);
  assert.equal(parseNumber('1.500'), 1500);
  assert.equal(parseNumber('1,500'), 1500);
  assert.equal(parseNumber('1.500.000'), 1500000);
  assert.equal(parseNumber('2.5'), 2.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1,500.50'), 1500.5);
  assert.equal(parseNumber('1.500,50'), 1500.5);
  assert.equal(parseNumber('2k'), 2000);
  assert.equal(parseNumber('2K'), 2000);
  assert.equal(parseNumber('1.5k'), 1500);
  assert.equal(parseNumber('1m'), 1000000);
  assert.equal(parseNumber('1.2.3'), null);
  assert.equal(parseNumber('abc'), null);
});

test('amounts: never join digits across spaces', () => {
  const a = parseAmount('300 2 croissants')!;
  assert.equal(a.amount, 300);
  assert.equal(a.note, '2 croissants');
  assert.equal(a.currency, null);
  assert.equal(a.explicit, false);
  assert.equal(parseAmount('1.500 groceries')!.amount, 1500);
  assert.equal(parseAmount('1,500 groceries')!.amount, 1500);
  assert.equal(parseAmount('2.5 usd tip')!.amount, 2.5);
  assert.equal(parseAmount('2k rent')!.amount, 2000);
  assert.equal(parseAmount('2K rent')!.amount, 2000);
  assert.equal(parseAmount('1m car')!.amount, 1000000);
});

test('amounts: currency and sign', () => {
  assert.deepEqual(parseAmount('$12 domain'), { amount: 12, currency: 'USD', sign: null, note: 'domain', explicit: true });
  assert.deepEqual(parseAmount('+3200 salary'), { amount: 3200, currency: null, sign: '+', note: 'salary', explicit: true });
  assert.deepEqual(parseAmount('coffee 4 usd'), { amount: 4, currency: 'USD', sign: null, note: 'coffee', explicit: true });
  assert.deepEqual(parseAmount('eur 4 coffee'), { amount: 4, currency: 'EUR', sign: null, note: 'coffee', explicit: true });
  assert.deepEqual(parseAmount('taxi 18eur'), { amount: 18, currency: 'EUR', sign: null, note: 'taxi', explicit: true });
  assert.deepEqual(parseAmount('15 € for lunch'), { amount: 15, currency: 'EUR', sign: null, note: 'lunch', explicit: true });
  assert.deepEqual(parseAmount('+ 1,200 eur salary'), { amount: 1200, currency: 'EUR', sign: '+', note: 'salary', explicit: true });
  // A number with a currency wins over an earlier bare number.
  assert.equal(parseAmount('2 coffees 7 usd')!.amount, 7);
  assert.equal(parseAmount('2 coffees 7 usd')!.note, '2 coffees');
  assert.deepEqual(parseAmount('£9 book'), { amount: 9, currency: 'GBP', sign: null, note: 'book', explicit: true });
  assert.equal(parseAmount('coffee'), null);
  assert.equal(parseAmount('0 coffee'), null);
});
