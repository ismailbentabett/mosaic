// Quick-add parser: "send invoice fri 3pm #admin !1 ~20m ^Work every mon after lunch". No dependencies.
import { addDays, dowOf } from '../../time.ts';
import type { Recur } from './recur.ts';
import { monthLen } from './recur.ts';

export type Parsed = {
  title: string; due_date?: string; due_time?: string; tags: string[]; priority?: number;
  est_minutes?: number; project?: string; recur?: Recur; anchor?: string; start_date?: string;
};

const DOW: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
export const ANCHORS = ['gym', 'breakfast', 'lunch', 'dinner'];
const pad = (n: number) => String(n).padStart(2, '0');

const nextDow = (today: string, dow: number) => {
  const diff = (dow - dowOf(today) + 7) % 7 || 7;
  return addDays(today, diff);
};
const fixYear = (today: string, m: number, d: number) => {
  const y = Number(today.slice(0, 4));
  if (m < 1 || m > 12 || d < 1 || d > monthLen(y, m)) return undefined;
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return s < today ? `${y + 1}-${pad(m)}-${pad(Math.min(d, monthLen(y + 1, m)))}` : s;
};
const time = (h: number, m: number, ap?: string) => {
  if (ap) { ap = ap.toLowerCase(); if (h < 1 || h > 12) return undefined; if (ap === 'pm' && h !== 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
  if (h > 23 || m > 59) return undefined;
  return `${pad(h)}:${pad(m)}`;
};

export const parseQuickAdd = (input: string, today: string): Parsed => {
  const out: Parsed = { title: '', tags: [] };
  let s = ` ${input.trim().replace(/\s+/g, ' ')} `;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = s.match(re);
    if (m && fn(m) !== false) s = s.replace(m[0], ' ');
  };

  // ^Project (until the next marker or end)
  take(/\s\^([^#!~^]+?)(?=\s[#!~^]|\s*$)/, (m) => { out.project = m[1].trim(); });
  // #tags (repeatable)
  for (let m = s.match(/\s#([\p{L}\p{N}_/-]+)/u); m; m = s.match(/\s#([\p{L}\p{N}_/-]+)/u)) { out.tags.push(m[1].toLowerCase()); s = s.replace(m[0], ' '); }
  // !1 high .. !3 low, !0 none
  take(/\s!([0-3])(?=\s)/, (m) => { const p = Number(m[1]); out.priority = p === 0 ? 0 : 4 - p; });
  // ~20m ~1h ~1h30 ~90
  take(/\s~(\d{1,3})(h|m|min)?(\d{1,2})?(?=\s)/i, (m) => {
    const v = Number(m[1]);
    out.est_minutes = m[2]?.toLowerCase() === 'h' ? v * 60 + Number(m[3] ?? 0) : v;
    if (!out.est_minutes || out.est_minutes > 600) { out.est_minutes = undefined; return false; }
  });
  // after <anchor>
  take(new RegExp(`\\s(?:after|before)\\s(${ANCHORS.join('|')})(?=\\s)`, 'i'), (m) => { out.anchor = m[1].toLowerCase(); });

  // recurrence
  take(/\s(?:every\s(?:day)|daily)(?=\s)/i, () => { out.recur = { freq: 'daily' }; });
  if (!out.recur) take(/\severy\sweekday(?=\s)/i, () => { out.recur = { freq: 'weekly', byday: [1, 2, 3, 4, 5] }; });
  if (!out.recur) take(/\severy\s((?:(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*(?:\s?(?:,|and)\s?)?)+)(?=\s)/i, (m) => {
    const days = m[1].split(/\s?(?:,|and)\s?|\s/).map((d) => DOW[d.toLowerCase()]).filter((d) => d !== undefined);
    if (!days.length) return false;
    out.recur = { freq: 'weekly', byday: [...new Set(days)].sort() };
  });
  if (!out.recur) take(/\severy\s(\d{1,3})?\s?(day|week|month|year)s?(?=\s)/i, (m) => {
    const unit = m[2].toLowerCase() as 'day';
    out.recur = { freq: ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const)[unit], interval: m[1] ? Number(m[1]) : 1 };
    if (out.recur.interval === 1) delete out.recur.interval;
  });
  if (!out.recur) take(/\s(?:weekly|monthly|yearly)(?=\s)/i, (m) => {
    out.recur = { freq: m[0].trim().toLowerCase() as 'weekly' };
  });

  // time: 3pm, 9:30am, 15:00, at 15
  take(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i, (m) => { out.due_time = time(Number(m[1]), Number(m[2] ?? 0), m[3]); if (!out.due_time) return false; });
  if (!out.due_time) take(/\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => { out.due_time = time(Number(m[1]), Number(m[2])); });
  if (!out.due_time) take(/\sat\s(\d{1,2})(?=\s)/i, (m) => { out.due_time = time(Number(m[1]), 0); if (!out.due_time) return false; });

  // dates
  take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => { out.due_date = `${m[1]}-${m[2]}-${m[3]}`; });
  if (!out.due_date) take(/\s(?:today|tod|tonight)(?=\s)/i, () => { out.due_date = today; });
  if (!out.due_date) take(/\s(?:tomorrow|tmr|tmrw|tom)(?=\s)/i, () => { out.due_date = addDays(today, 1); });
  if (!out.due_date) take(/\snext\sweek(?=\s)/i, () => { out.due_date = nextDow(today, 1); });
  if (!out.due_date) take(/\sin\s(\d{1,3})\s(day|week|month)s?(?=\s)/i, (m) => {
    const n = Number(m[1]); const u = m[2].toLowerCase();
    out.due_date = u === 'day' ? addDays(today, n) : u === 'week' ? addDays(today, 7 * n) : addDays(today, 30 * n);
  });
  if (!out.due_date) take(/\s(?:on\s)?(?:next\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?(?=\s)/i, (m) => {
    out.due_date = nextDow(today, DOW[m[1].toLowerCase()]);
  });
  if (!out.due_date) take(/\s(\d{1,2})\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?=\s)/i, (m) => {
    out.due_date = fixYear(today, MON[m[2].toLowerCase()], Number(m[1])); if (!out.due_date) return false;
  });
  if (!out.due_date) take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s(\d{1,2})(?=\s)/i, (m) => {
    out.due_date = fixYear(today, MON[m[1].toLowerCase()], Number(m[2])); if (!out.due_date) return false;
  });
  // DD/MM (day-first order)
  if (!out.due_date) take(/\s(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => { out.due_date = fixYear(today, Number(m[2]), Number(m[1])); if (!out.due_date) return false; });

  if (out.due_time && !out.due_date) out.due_date = today;
  if (out.recur && !out.due_date) {
    out.due_date = out.recur.byday?.length && !out.recur.byday.includes(dowOf(today))
      ? (() => { for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (out.recur!.byday!.includes(dowOf(d))) return d; } return today; })()
      : today;
  }
  out.title = s.replace(/\s+/g, ' ').trim() || input.trim();
  if (!out.tags.length) out.tags = [];
  return out;
};
