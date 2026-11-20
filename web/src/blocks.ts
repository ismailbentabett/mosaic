// avoid-ai-design-ignore: I2 -- emoji here parse calendar titles (data), never rendered as icons.
import type { CalEvent } from './api';

export type BlockType = 'start' | 'focus' | 'project' | 'meet' | 'weekend' | 'anchor' | 'other';

const MAP: [string, BlockType][] = [
  ['🚀', 'start'],
  ['🧱', 'focus'],
  ['🧠', 'focus'],
  ['🛠', 'project'],
  ['📞', 'meet'],
  ['🗓', 'weekend'],
];

/** Colour family from the leading emoji (variation selectors ignored). */
export function blockType(e: Pick<CalEvent, 'emoji' | 'title' | 'kind'>): BlockType {
  if (e.kind === 'anchor') return 'anchor';
  const src = (e.emoji ?? e.title ?? '').replace(/️/g, '');
  for (const [emoji, type] of MAP) if (src.startsWith(emoji)) return type;
  return e.kind === 'block' ? 'other' : 'anchor';
}

/** Title without the leading emoji, for compact display next to an emoji glyph. */
export function splitEmoji(title: string): { emoji: string; rest: string } {
  const m = /^(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s*(.*)$/u.exec(title);
  return m ? { emoji: m[1]!, rest: m[2]! } : { emoji: '', rest: title };
}

/** Event whose span contains `now`; blocks win over anchors when they overlap. */
export function currentEvent(events: CalEvent[], now: number): CalEvent | null {
  const live = events.filter((e) => !e.allDay && Date.parse(e.start) <= now && now < Date.parse(e.end));
  return live.find((e) => e.kind === 'block') ?? live[0] ?? null;
}

export type AnchorKind = 'meal' | 'sleep' | 'other';

const ANCHORS: [string, AnchorKind][] = [
  ['🍽', 'meal'],
  ['😴', 'sleep'],
  ['🌙', 'sleep'],
];

/** Kind of a fixed anchor (meal, sleep); null for writable blocks. Anchors are never editable. */
export function anchorKind(e: Pick<CalEvent, 'emoji' | 'title' | 'kind'>): AnchorKind | null {
  if (e.kind === 'block') return null;
  const src = (e.emoji ?? e.title ?? '').replace(/️/g, '');
  for (const [emoji, kind] of ANCHORS) if (src.startsWith(emoji)) return kind;
  return 'other';
}

/** Timed events of the day in start order (all-day banners left out). */
export function timeline(events: CalEvent[]): CalEvent[] {
  return events.filter((e) => !e.allDay).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function nextEvent(events: CalEvent[], now: number): CalEvent | null {
  return (
    events
      .filter((e) => !e.allDay && Date.parse(e.start) > now)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] ?? null
  );
}

/** A block's priority tick: the done state of its mirrored app task. */
export const blockDone = (e: Pick<CalEvent, 'taskDone'>): boolean => !!e.taskDone;
