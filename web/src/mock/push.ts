// /api/v2/push/* for the mock: notification centre (status, prefs, history, held, scheduled, test).
// Mock only: loaded through mock.ts behind MOCK. Shapes mirror app/api/src/pushCenter.ts.
import { PUSH_CATS, type HeldPush, type PushCat, type PushLogRow, type PushPrefs, type ScheduledPush } from '../v2';
import { at, bad, created, iso, match, notFound, ok, today, type Ctx, type Res } from './util';

const LABELS: Record<PushCat, string> = {
  tasks: 'Task reminders', blocks: 'Block heads-up', timer: 'Timer and rest', gym: 'Gym', brief: 'Morning brief',
  docs: 'Document dates', wishlist: 'Wishlist', nightly: 'Nightly plan', ops: 'Server health', custom: 'Other',
};
let prefs: Omit<PushPrefs, 'labels'> = {
  cats: Object.fromEntries(PUSH_CATS.map((c) => [c, true])) as Record<PushCat, boolean>,
  block_lead_min: 2,
  hourly_cap: 6,
  snooze_min: 10,
};
const clamp = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

let seq = 100;
const ago = (min: number) => iso(Date.now() - min * 60_000);
const log: PushLogRow[] = [
  { id: 9, at: ago(12), cat: 'blocks', title: 'Deep work in 2 min', message: 'Design the portfolio case study layout', priority: 4, status: 'sent', reason: null, key: 'block:1' },
  { id: 8, at: ago(55), cat: 'tasks', title: 'Call the bank', message: 'Due 14:00', priority: 3, status: 'sent', reason: null, key: 'task:t1' },
  { id: 7, at: ago(70), cat: 'wishlist', title: 'Wishlist: price drop', message: 'Headphones down 12%', priority: 2, status: 'muted', reason: 'category off', key: null },
  { id: 6, at: ago(95), cat: 'tasks', title: 'Call the bank', message: 'Due 14:00', priority: 3, status: 'deduped', reason: 'same push 6 min ago', key: null },
  { id: 5, at: ago(130), cat: 'timer', title: 'Time is up', message: 'Project work. Stop here or add 5 min.', priority: 4, status: 'sent', reason: null, key: 'timer' },
  { id: 4, at: ago(240), cat: 'docs', title: 'Passport expires in 30 days', message: 'Open Documents to renew.', priority: 3, status: 'held', reason: 'sleep', key: 'doc:pass' },
  { id: 3, at: ago(600), cat: 'brief', title: 'Morning', message: '3 priorities today. First: Deep work at 08:15.', priority: 3, status: 'sent', reason: null, key: 'brief' },
  { id: 2, at: ago(900), cat: 'ops', title: 'Google sign-in expired', message: 'Open Settings to reconnect.', priority: 4, status: 'failed', reason: 'push 502', key: 'google' },
];
let held: HeldPush[] = [
  { id: 1, key: 'doc:visa', title: 'Visa appointment in 7 days', message: 'Check the papers list.', cat: 'docs', priority: 3, reason: 'sleep', held_at: ago(30), expires_at: null },
];
let scheduled: ScheduledPush[] = [
  { id: 1, key: null, at: at(today(), '18:30'), title: 'Reminder', message: 'Buy bread on the way back', cat: 'custom', task_id: null, created_at: ago(60) },
];

const hm = (isoAt: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoAt));

function status() {
  const since = Date.now() - 86_400_000;
  const day = log.filter((r) => Date.parse(r.at) >= since);
  const n = (s: string) => day.filter((r) => r.status === s).length;
  const blocks = [
    { at: at(today(), '15:28'), title: '🧠 Deep work · Design the portfolio case study layout', kind: 'block' as const, task_id: 't_pa' },
    { at: at(today(), '16:28'), title: '📞 Meetings · Reply to 3 emails, 1 call', kind: 'block' as const, task_id: 't_pb' },
  ];
  const upcoming = [
    ...blocks,
    ...scheduled.map((s) => ({ at: s.at, title: s.message || s.title, kind: 'scheduled' as const, task_id: s.task_id, id: s.id })),
  ]
    .filter((u) => Date.parse(u.at) > Date.now())
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((u) => ({ ...u, hhmm: hm(u.at) }));
  return {
    quiet: false,
    reason: null,
    until: null,
    sleep: { start: '23:30', wake: '07:30' },
    mode: 'Normal',
    held: held.length,
    upcoming,
    last24h: { sent: n('sent'), held: n('held'), muted: n('muted'), deduped: n('deduped'), failed: n('failed') },
    last_sent: log.find((r) => r.status === 'sent') ?? null,
  };
}

function addLog(title: string, message: string, cat: string, st: PushLogRow['status'], reason: string | null) {
  log.unshift({ id: ++seq, at: iso(), cat, title, message, priority: 3, status: st, reason, key: null });
}

export function handlePush(c: Ctx): Res | null {
  if (!c.p.startsWith('/push/')) return null;
  const r = c.route;
  if (r === 'GET /push/status') return ok(status());
  if (r === 'GET /push/prefs') return ok({ ...prefs, labels: LABELS });
  if (r === 'PUT /push/prefs') {
    const b = c.b as { cats?: Record<string, unknown>; block_lead_min?: unknown; hourly_cap?: unknown; snooze_min?: unknown };
    const cats = { ...prefs.cats };
    for (const [k, v] of Object.entries(b.cats ?? {})) if ((PUSH_CATS as readonly string[]).includes(k) && typeof v === 'boolean') cats[k as PushCat] = v;
    prefs = {
      cats,
      block_lead_min: b.block_lead_min == null ? prefs.block_lead_min : clamp(b.block_lead_min, 0, 30, prefs.block_lead_min),
      hourly_cap: b.hourly_cap == null ? prefs.hourly_cap : clamp(b.hourly_cap, 1, 30, prefs.hourly_cap),
      snooze_min: b.snooze_min == null ? prefs.snooze_min : clamp(b.snooze_min, 5, 120, prefs.snooze_min),
    };
    return ok({ ...prefs, labels: LABELS });
  }
  if (r === 'GET /push/log') {
    const limit = clamp(c.qp.get('limit'), 1, 500, 50);
    const cat = c.qp.get('cat');
    return ok({ items: log.filter((x) => !cat || x.cat === cat).slice(0, limit) });
  }
  if (r === 'GET /push/held') return ok({ items: held });
  if (r === 'POST /push/held/flush') {
    const sent = held.length;
    held.forEach((h) => addLog(h.title, h.message, h.cat, 'sent', 'sent now'));
    held = [];
    return ok({ sent, held: 0 });
  }
  let m = match(r, /^DELETE \/push\/held\/(\d+)$/);
  if (m) {
    const id = Number(m[0]);
    if (!held.some((h) => h.id === id)) return notFound('Held push');
    held = held.filter((h) => h.id !== id);
    return ok({ ok: true });
  }
  if (r === 'GET /push/scheduled') return ok({ items: scheduled });
  if (r === 'POST /push/scheduled') {
    const atIn = c.b.at;
    if (typeof atIn !== 'string') return bad('at is required (HH:MM or ISO)');
    const when = /^\d{2}:\d{2}$/.test(atIn) ? at(today(), atIn) : atIn;
    if (!Number.isFinite(Date.parse(when))) return bad('at must be HH:MM or ISO');
    const row: ScheduledPush = {
      id: ++seq, key: null, at: when, title: typeof c.b.title === 'string' ? c.b.title : 'Reminder',
      message: typeof c.b.message === 'string' ? c.b.message : '', cat: 'custom',
      task_id: typeof c.b.task_id === 'string' ? c.b.task_id : null, created_at: iso(),
    };
    scheduled = [...scheduled, row].sort((a, b) => a.at.localeCompare(b.at));
    return created(row);
  }
  m = match(r, /^DELETE \/push\/scheduled\/(\d+)$/);
  if (m) {
    const id = Number(m[0]);
    if (!scheduled.some((s) => s.id === id)) return notFound('Scheduled push');
    scheduled = scheduled.filter((s) => s.id !== id);
    return ok({ ok: true });
  }
  if (r === 'POST /push/test') {
    addLog('Mosaic test', 'Notifications work. Tap to open the notification settings.', 'custom', 'sent', 'test');
    return ok({ status: 'sent', reason: 'test' });
  }
  return null;
}
