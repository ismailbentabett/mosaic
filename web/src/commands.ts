import { api, type CalEvent, type TodayData } from './api';
import { splitEmoji } from './blocks';
import { hm, minutesLeft } from './time';

const nameOf = (e: CalEvent) => splitEmoji(e.blockName ?? e.baseTitle).rest;

/** Today's plan as a few spoken sentences. */
export function planSpeech(d: TodayData, now = Date.now()): string {
  const timed = d.events.filter((e) => !e.allDay);
  const blocks = timed.filter((e) => e.kind === 'block' && Date.parse(e.end) > now).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const parts: string[] = [];
  const cur = timed.find((e) => Date.parse(e.start) <= now && now < Date.parse(e.end));
  if (d.mode !== 'Normal') parts.push(`Mode is ${d.mode}.`);
  if (cur) parts.push(`Now: ${cur.task ?? nameOf(cur)}, ${minutesLeft(cur.end, now)} minutes left.`);
  const open = d.musts.filter((m) => !m.taskDone);
  const done = d.musts.length - open.length;
  if (done) parts.push(`${done === 1 ? 'One priority' : `${done} priorities`} done.`);
  if (open.length) parts.push(`Still open: ${open.map((m) => m.task ?? nameOf(m)).join('; ')}.`);
  const later = blocks.filter((b) => b !== cur).slice(0, 4);
  if (later.length) parts.push('Coming up: ' + later.map((b) => `${hm(b.start)}, ${b.task ?? nameOf(b)}`).join('. ') + '.');
  if (!parts.length) parts.push('Nothing else on the calendar today.');
  return parts.join(' ');
}

export async function fetchPlanSpeech(): Promise<string> {
  return planSpeech(await api.today());
}

/** Lets other parts of the app ask Today to reload (e.g. after a timer starts). */
export const TODAY_REFRESH = 'mosaic:today-refresh';
export const refreshToday = () => window.dispatchEvent(new Event(TODAY_REFRESH));
