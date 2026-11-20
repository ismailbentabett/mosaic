import { describe, expect, it } from 'vitest';
import { addDays, detect, knownFood, matchHabit, parseFood, parseMoney, parseSet, parseTask, parseWater, parseWeight, patternKey, preview, stripPrefix } from './parseQuick';

const TODAY = '2026-11-12'; // a Thursday

describe('detect', () => {
  const d = (t: string, ctx = {}) => detect(t, ctx).type;

  it('defaults to task', () => {
    expect(d('Call mom tomorrow')).toBe('task');
    expect(d('Buy milk')).toBe('task');
    expect(d('Send 10 emails to the team')).toBe('task');
    expect(d('3x8 bench')).toBe('task'); // no workout, no weight
  });
  it('reads prefixes', () => {
    expect(detect('note: slept badly', {})).toEqual({ type: 'note', why: 'prefix', text: 'slept badly' });
    expect(d('idea: template marketplace')).toBe('idea');
    expect(d('task: 500 newsletter emails')).toBe('task');
    expect(d('spent 500 coffee')).toBe('expense');
    expect(d('ate 2 eggs')).toBe('food');
    expect(d('w 72.4')).toBe('weight');
  });
  it('money', () => {
    expect(d('500 coffee')).toBe('expense');
    expect(d('$12 domain')).toBe('expense');
    expect(d('taxi 18eur')).toBe('expense');
    expect(d('+1200 salary')).toBe('income');
    expect(d('+$400 salary')).toBe('income');
  });
  it('counts are never money', () => {
    expect(detect('10 emails to the team in Leeds', {})).toEqual({ type: 'note', why: 'count:done', text: '10 emails to the team in Leeds' });
    expect(detect('5 applications', {}).why).toBe('count:done');
    expect(detect('5 pages', {}).why).toBe('count:done');
    expect(detect('123400 km', {}).why).toBe('count:car_km');
    expect(d('3 calls')).toBe('note');
    expect(d('20 sites')).toBe('note');
  });
  it('money only on a clear signal', () => {
    expect(d('800 xyz')).toBe('task');
    expect(d('1.500 groceries')).toBe('expense');
    expect(d('300 2 croissants')).toBe('expense');
    expect(d('2k rent')).toBe('expense');
    expect(d('lunch 5 eur')).toBe('expense');
    expect(parseMoney('300 2 croissants')).toMatchObject({ amount: 300, note: '2 croissants' });
    expect(parseMoney('2K rent')?.amount).toBe(2000);
  });
  it('body and water', () => {
    expect(d('72.4kg')).toBe('weight');
    expect(d('72,4 kg')).toBe('weight');
    expect(d('500ml')).toBe('water');
    expect(d('water')).toBe('water');
    expect(d('2 glasses')).toBe('water');
  });
  it('sets', () => {
    expect(d('3x8 bench', { activeWorkout: true })).toBe('set');
    expect(d('bench 60kg x 8')).toBe('set');
    expect(d('squat 3x5 @100')).toBe('set');
  });
  it('habits and foods', () => {
    expect(d('Reading', { habits: ['Reading', 'Stretching'] })).toBe('habit');
    expect(d('did stretching', { habits: ['Reading', 'Stretching'] })).toBe('habit');
    expect(d('2 eggs', { foods: ['egg'] })).toBe('food');
    expect(d('200g chicken', { foods: ['chicken breast'] })).toBe('task');
    expect(d('pizza 800kcal')).toBe('food');
  });
  it('remembers manual choices by shape', () => {
    const overrides = { [patternKey('2 eggs')]: 'food' as const };
    expect(d('3 eggs', { overrides })).toBe('food');
    expect(d('500 coffee', { overrides })).toBe('expense');
  });
});

describe('patternKey', () => {
  it('replaces numbers and keeps two words', () => {
    expect(patternKey('500 coffee with Amine')).toBe('9 coffee');
    expect(patternKey('650 Coffee')).toBe('9 coffee');
    expect(patternKey('Call mom')).toBe('call mom');
  });
});

describe('parseMoney', () => {
  it('amount, currency, note', () => {
    expect(parseMoney('500 coffee')).toEqual({ amount: 500, currency: null, income: false, note: 'coffee', explicit: false });
    expect(parseMoney('$12.50 domain')).toEqual({ amount: 12.5, currency: 'USD', income: false, note: 'domain', explicit: true });
    expect(parseMoney('taxi 18 eur')).toEqual({ amount: 18, currency: 'EUR', income: false, note: 'taxi', explicit: true });
    expect(parseMoney('+1,200 eur salary')).toEqual({ amount: 1200, currency: 'EUR', income: true, note: 'salary', explicit: true });
    expect(parseMoney('15 € for lunch')).toEqual({ amount: 15, currency: 'EUR', income: false, note: 'lunch', explicit: true });
  });
  it('rejects text without an amount', () => {
    expect(parseMoney('coffee')).toBeNull();
    expect(parseMoney('0 coffee')).toBeNull();
  });
});

describe('parseWeight / parseWater', () => {
  it('weight', () => {
    expect(parseWeight('72.4kg')).toEqual({ kg: 72.4 });
    expect(parseWeight('weight 71')).toEqual({ kg: 71 });
    expect(parseWeight('bench 60kg')).toBeNull();
  });
  it('water', () => {
    expect(parseWater('500ml')).toEqual({ ml: 500 });
    expect(parseWater('1.5l water')).toEqual({ ml: 1500 });
    expect(parseWater('2 glasses')).toEqual({ ml: 500 });
    expect(parseWater('bottle')).toEqual({ ml: 500 });
    expect(parseWater('water')).toEqual({ ml: 250 });
    expect(parseWater('water 750')).toEqual({ ml: 750 });
    expect(parseWater('water the plants')).toBeNull();
  });
});

describe('parseSet', () => {
  it('reads the common shapes', () => {
    expect(parseSet('bench 3x8 @60')).toEqual({ exercise: 'bench', sets: 3, reps: 8, weight: 60 });
    expect(parseSet('squat 80x5')).toEqual({ exercise: 'squat', sets: 1, reps: 5, weight: 80 });
    expect(parseSet('bench 60kg x 8')).toEqual({ exercise: 'bench', sets: 1, reps: 8, weight: 60 });
    expect(parseSet('3x10 pullups')).toEqual({ exercise: 'pullups', sets: 3, reps: 10, weight: null });
    expect(parseSet('deadlift 100 kg 5 reps')).toEqual({ exercise: 'deadlift', sets: 1, reps: 5, weight: 100 });
    expect(parseSet('row 3x10x50')).toEqual({ exercise: 'row', sets: 3, reps: 10, weight: 50 });
  });
  it('rejects non-sets', () => {
    expect(parseSet('bench press')).toBeNull();
  });
});

describe('parseFood', () => {
  it('grams, qty, kcal', () => {
    expect(parseFood('200g chicken')).toEqual({ name: 'chicken', grams: 200, qty: null, kcal: null });
    expect(parseFood('chicken 150 g')).toEqual({ name: 'chicken', grams: 150, qty: null, kcal: null });
    expect(parseFood('2 eggs')).toEqual({ name: 'eggs', grams: null, qty: 2, kcal: null });
    expect(parseFood('half a baguette')).toEqual({ name: 'baguette', grams: null, qty: 0.5, kcal: null });
    expect(parseFood('pizza 800kcal')).toEqual({ name: 'pizza', grams: null, qty: null, kcal: 800 });
  });
  it('knownFood handles plurals', () => {
    expect(knownFood('2 eggs', ['Egg'])).toBe('Egg');
    expect(knownFood('3 dates', ['dates'])).toBe('dates');
    expect(knownFood('bread', ['Egg'])).toBeNull();
  });
});

describe('matchHabit', () => {
  it('exact and "did" forms', () => {
    expect(matchHabit('reading', ['Reading'])).toBe('Reading');
    expect(matchHabit('Reading done', ['Reading'])).toBe('Reading');
    expect(matchHabit('did some reading today', ['Reading'])).toBeNull();
  });
});

describe('parseTask', () => {
  it('date words', () => {
    expect(parseTask('Call mom tomorrow', TODAY)).toMatchObject({ title: 'Call mom', when: '2026-11-13' });
    expect(parseTask('Pay rent today', TODAY)).toMatchObject({ title: 'Pay rent', when: TODAY });
    expect(parseTask('Email Karim on monday', TODAY)).toMatchObject({ title: 'Email Karim', when: '2026-11-16' });
    expect(parseTask('Review thu', TODAY)).toMatchObject({ when: '2026-11-19' }); // same weekday = next week
    expect(parseTask('Plan next week', TODAY)).toMatchObject({ title: 'Plan', when: '2026-11-14' });
    expect(parseTask('Clean car weekend', TODAY)).toMatchObject({ title: 'Clean car', when: '2026-11-14' });
    expect(parseTask('Learn Rust someday', TODAY)).toMatchObject({ title: 'Learn Rust', someday: true, when: null });
  });
  it('project and minutes', () => {
    expect(parseTask('Fix footer ^stu 25m', TODAY, ['Studio', 'Home'])).toMatchObject({ title: 'Fix footer', project: 'Studio', minutes: 25 });
    expect(parseTask('Tidy #home 1h', TODAY, ['Studio', 'Home'])).toMatchObject({ title: 'Tidy', project: 'Home', minutes: 60 });
  });
});

describe('preview', () => {
  const c = { today: TODAY, projects: ['Studio'], habits: ['Reading'] };
  it('one line per type', () => {
    expect(preview('task', 'Call mom tomorrow', c)).toBe('Task “Call mom” · in Inbox · tomorrow');
    expect(preview('task', 'Fix footer ^stu', { ...c, project: null })).toBe('Task “Fix footer” · in Studio');
    expect(preview('expense', '500 coffee', c)).toBe('Expense $500 · coffee');
    expect(preview('income', '+$400 salary', c)).toBe('Income $400 · salary');
    expect(preview('water', '500ml', c)).toBe('Water +500 ml');
    expect(preview('weight', '72.4kg', c)).toBe('Weight 72.4 kg');
    expect(preview('set', 'bench 3x8 @60', c)).toBe('3 sets of 8 reps @ 60 kg · bench');
    expect(preview('habit', 'reading', c)).toBe('Check “Reading” for today');
    expect(preview('task', '   ', c)).toBeNull();
  });
  it('shows where a count goes', () => {
    const a = { ...c, auto: true };
    expect(preview('note', '5 pages', a)).toBe('Done log · 5 pages');
    expect(preview('note', '123400 km', a)).toBe('Car odometer · 123400 km');
    expect(preview('note', '10 emails to the team in Leeds', a)).toBe('Done log · 10 emails to the team in Leeds');
    expect(preview('note', '10 emails to the team in Leeds', c)).toBe("Note in today's log · 10 emails to the team in Leeds");
    expect(preview('expense', '300 2 croissants', c)).toBe('Expense $300 · 2 croissants');
  });
});

describe('helpers', () => {
  it('addDays crosses months', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('stripPrefix leaves plain text alone', () => {
    expect(stripPrefix('Call mom')).toEqual({ type: null, rest: 'Call mom' });
  });
});
