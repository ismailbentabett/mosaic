// One plain line about money for the Life hub card.
import * as f from '../../fmt';
import type { LifeSnapshot } from '../../v2';

/** "$42 spent this week · 30 weeks runway" (or a shorter line when parts are missing). */
export function moneySummaryLine(m: LifeSnapshot['money'] | null | undefined): string {
  if (!m) return '';
  const parts = [`${f.usd(m.week?.spend_usd ?? 0)} spent this week`];
  const w = m.runway?.runway_weeks;
  if (w !== null && w !== undefined) parts.push(`${f.weeks(w)} runway`);
  return parts.join(' · ');
}
