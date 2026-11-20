// Pure helpers behind the food, gym and body screens: meal slots, PR wording, body headline.
import { describe, expect, it } from 'vitest';
import { fixedDomain, weightHeadline } from './body/lib';
import { kcalLeftLine, maintenanceLine, slotAt, slotChoices } from './food/lib';
import { prFinishLine, prLabel, prToastLine } from './gym/kit';
import type { Tdee } from '../v2';

const sp = (s: string | null) => s?.replace(/ | /g, ' ') ?? null;
const hm = (h: number, m = 0) => h * 60 + m;

describe('meal slots (same rule as the server)', () => {
  it('everyday rule', () => {
    expect(slotAt(hm(10, 30))).toBe('breakfast');
    expect(slotAt(hm(12, 30))).toBe('lunch');
    expect(slotAt(hm(16, 30))).toBe('snacks');
    expect(slotAt(hm(19))).toBe('dinner');
    expect(slotAt(hm(23))).toBe('snacks');
    expect(slotAt(hm(2))).toBe('snacks');
  });

  it('everyday slots lead the choices', () => {
    expect(slotChoices()).toEqual(['breakfast', 'lunch', 'dinner', 'snacks', 'late']);
  });
});

describe('food lines', () => {
  it('kcal left, never "over"', () => {
    expect(sp(kcalLeftLine(420))).toMatch(/^420 kcal left$/);
    expect(kcalLeftLine(0)).toBeNull();
    expect(kcalLeftLine(-200)).toBeNull();
    expect(kcalLeftLine(null)).toBeNull();
  });

  it('maintenance line with suggested target, or the reason', () => {
    const t: Tdee = { adaptive: { from: 'a', to: 'b', counted_days: 14, weigh_ins: 8, tdee: 2600 }, suggestion: { kcal: 2100, method: 'adaptive' } };
    expect(sp(maintenanceLine(t))).toMatch(/2,?600 kcal.*Suggested target ~2,?100 kcal/);
    const none: Tdee = { adaptive: { from: 'a', to: 'b', counted_days: 3, weigh_ins: 1, tdee: null, reason: 'needs 10 complete days' }, suggestion: { kcal: null, method: null } };
    expect(maintenanceLine(none)).toBe('Maintenance estimate: needs 10 complete days.');
  });
});

describe('gym PR wording', () => {
  it('readable labels', () => {
    expect(prLabel('heaviest')).toBe('Heaviest weight');
    expect(prLabel('e1rm')).toBe('Best estimated 1-rep max');
    expect(sp(prLabel('reps@60'))).toBe('Most reps at 60 kg');
  });

  it('toast picks the top PR; nothing without one', () => {
    expect(sp(prToastLine([{ kind: 'volume', value: 600 }, { kind: 'heaviest', value: 62.5 }]))).toBe('New best · Heaviest weight 62.5 kg');
    expect(prToastLine([])).toBeNull();
    expect(prToastLine(undefined)).toBeNull();
  });

  it('finish line names exercises once', () => {
    expect(prFinishLine([{ exercise_name: 'Bench press', kind: 'heaviest' }, { exercise_name: 'Bench press', kind: 'e1rm' }, { exercise_name: 'Squat', kind: 'volume' }])).toBe(
      '2 new bests (Bench press, Squat)',
    );
    expect(prFinishLine([])).toBeNull();
  });
});

describe('body headline and axis', () => {
  it('plain words, no signs', () => {
    expect(sp(weightHeadline(81.2, 81.5))).toBe('7-day average 81.2 kg, down 0.3 from last week');
    expect(sp(weightHeadline(81.2, 81.24))).toBe('7-day average 81.2 kg, about the same as last week');
    expect(sp(weightHeadline(81.2, null))).toBe('7-day average 81.2 kg');
    expect(weightHeadline(null, 80)).toBeNull();
  });

  it('fixed ±3 kg axis, widened only when needed', () => {
    expect(fixedDomain([80, 81])).toEqual([77.5, 83.5]);
    const [lo, hi] = fixedDomain([75, 85])!;
    expect(lo).toBeLessThanOrEqual(75);
    expect(hi).toBeGreaterThanOrEqual(85);
    expect(fixedDomain([])).toBeNull();
  });
});
