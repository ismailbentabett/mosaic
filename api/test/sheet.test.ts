import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalMode, modeFromRows, rowsToObjects, looksLikeFormula, tab } from '../src/sheet.ts';

test('mode parsing', () => {
  assert.equal(canonicalMode(' zero '), 'Zero');
  assert.equal(canonicalMode('FAMILY'), 'Family');
  assert.equal(canonicalMode('party'), null);
  assert.equal(modeFromRows([['cash', '1000'], [' Mode ', 'family']]), 'Family');
  assert.equal(modeFromRows([['cash', '1000']]), null);
  assert.equal(tab("Rules+Money"), "'Rules+Money'");
  assert.equal(tab("it's"), "'it''s'");
});

test('sheet rows and formula guard', () => {
  const rows = rowsToObjects([['name', 'kind', 'note'], ['Rent', 'fixed', 'monthly'], ['', '', ''], ['Gym', 'fixed']]);
  assert.deepEqual(rows, [{ name: 'Rent', kind: 'fixed', note: 'monthly' }, { name: 'Gym', kind: 'fixed', note: '' }]);
  assert.equal(looksLikeFormula('@foo'), true);
  assert.equal(looksLikeFormula('+1.5'), false);
  assert.equal(looksLikeFormula('+1 (555) 010-0100'), false);
  assert.equal(looksLikeFormula('-A1'), true);
  assert.equal(looksLikeFormula('=1+1'), true);
});
