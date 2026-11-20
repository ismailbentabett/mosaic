// One place for the notification centre: what REST (/api/v2/push/*) and MCP (push_*) both call.
import { AppError } from './errors.ts';
import {
  notify, getPushPrefs, setPushPrefs, pushLog, heldList, dropHeld, flushHeld, quietNow, openLink,
  CAT_LABELS, PUSH_CATS, type PushCat, type PushMsg,
} from './ntfy.ts';
import { upcoming, scheduledList, schedulePush, cancelScheduled } from './notify.ts';

const isCat = (c: unknown): c is PushCat => typeof c === 'string' && (PUSH_CATS as readonly string[]).includes(c);
const prio = (p: unknown) => {
  if (p === undefined || p === null) return 3;
  const n = Number(p);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new AppError('bad_request', 'priority must be 1-5');
  return n as 1 | 2 | 3 | 4 | 5;
};

export const pushPrefs = () => ({ ...getPushPrefs(), labels: CAT_LABELS });
export const updatePushPrefs = (b: Record<string, unknown>) => {
  setPushPrefs(b as Parameters<typeof setPushPrefs>[0]);
  return pushPrefs();
};

/** Everything the screen needs in one read. */
export const pushStatus = (now = new Date()) => {
  const q = quietNow(now);
  const log = pushLog(200);
  const since = now.getTime() - 86_400_000;
  const day = log.filter((r) => Date.parse(r.at) >= since);
  const count = (s: string) => day.filter((r) => r.status === s).length;
  return {
    ...q,
    upcoming: upcoming(now).slice(0, 20),
    last24h: { sent: count('sent'), held: count('held'), muted: count('muted'), deduped: count('deduped'), failed: count('failed') },
    last_sent: log.find((r) => r.status === 'sent') ?? null,
  };
};

export const pushLogList = (limit?: number, cat?: string) => {
  if (cat && !isCat(cat)) throw new AppError('bad_request', `cat must be one of ${PUSH_CATS.join(', ')}`);
  return { items: pushLog(Math.min(500, Math.max(1, limit ?? 50)), cat) };
};
export const heldItems = () => ({ items: heldList() });
export const heldDrop = (id: number) => {
  if (!dropHeld(id)) throw new AppError('not_found', `held push ${id}`);
  return { ok: true };
};
export const heldFlush = async () => flushHeld(new Date(), true);

export const scheduledItems = () => ({ items: scheduledList() });
export const scheduleAdd = (b: Record<string, unknown>) => {
  if (typeof b.at !== 'string') throw new AppError('bad_request', 'at is required (HH:MM or ISO)');
  if (b.cat !== undefined && !isCat(b.cat)) throw new AppError('bad_request', `cat must be one of ${PUSH_CATS.join(', ')}`);
  return schedulePush({
    at: b.at,
    title: typeof b.title === 'string' ? b.title : undefined,
    message: typeof b.message === 'string' ? b.message : typeof b.body === 'string' ? b.body : undefined,
    priority: prio(b.priority),
    cat: b.cat as PushCat | undefined,
    key: typeof b.key === 'string' ? b.key.slice(0, 80) : null,
    task_id: typeof b.task_id === 'string' ? b.task_id : null,
  });
};
export const scheduleCancel = (id: number) => {
  if (!cancelScheduled(id)) throw new AppError('not_found', `scheduled push ${id}`);
  return { ok: true };
};

/** A push now, through the full pipeline (quiet hours, mute, cap). Returns what happened. */
export const sendPush = (b: { title: string; message: string; priority?: unknown; cat?: unknown; click?: string; key?: string }) => {
  if (b.cat !== undefined && !isCat(b.cat)) throw new AppError('bad_request', `cat must be one of ${PUSH_CATS.join(', ')}`);
  const m: PushMsg = {
    title: b.title.slice(0, 100), message: b.message.slice(0, 1000), priority: prio(b.priority),
    cat: (b.cat as PushCat | undefined) ?? 'custom',
    ...(b.click ? { click: /^[a-z]+$/.test(b.click) ? openLink(b.click) : b.click } : {}),
    ...(b.key ? { key: b.key.slice(0, 80) } : {}),
  };
  return notify(m);
};

/** Test push: ignores mute and quiet (priority 5 path is not used: it would ring loud), so it goes out as-is. */
export const testPush = () => notify({ title: 'Mosaic test', message: 'Notifications work. Tap to open the notification settings.', priority: 3, cat: 'custom', click: openLink('notifications'), force: true });
