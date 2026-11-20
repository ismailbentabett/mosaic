// Body wording and chart helpers: plain sentences, no signed red/green deltas, no verdicts.
import * as f from '../../fmt';

/** "7-day average 81.2 kg, down 0.3 from last week" / "about the same as last week" / no comparison yet. */
export function weightHeadline(avg7: number | null | undefined, prev7: number | null | undefined): string | null {
  if (avg7 == null) return null;
  const head = `7-day average ${f.kg(avg7)}`;
  if (prev7 == null) return head;
  const d = Math.round((avg7 - prev7) * 10) / 10;
  if (Math.abs(d) < 0.1) return `${head}, about the same as last week`;
  return `${head}, ${d < 0 ? 'down' : 'up'} ${f.fixed(Math.abs(d), 1)} from last week`;
}

/**
 * Fixed y-axis around the data so daily water swings look as small as they are:
 * ±`half` around the middle, widened only when the data needs more room.
 */
export function fixedDomain(values: number[], half = 3): [number, number] | null {
  if (!values.length) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const h = Math.max(half, (hi - lo) / 2 + 0.5);
  return [Math.floor((mid - h) * 2) / 2, Math.ceil((mid + h) * 2) / 2];
}
