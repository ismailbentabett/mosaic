// HTTP entry: app + /api + /mcp on 127.0.0.1 only. Public Caddy fronts it on :443.
import { serve } from '@hono/node-server';
import { buildApp } from './routes.ts';
import { PORT } from './config.ts';
import { getDb, kvGet, kvSet } from './db.ts';
import { lifeToday } from './time.ts';
import { compost } from './modules/ideas/store.ts';
import { restoreTimer } from './timer.ts';
import { push, flushHeld } from './ntfy.ts';
import { remindersTick } from './notify.ts';
import { seedAsks } from './modules/profile/store.ts';
import { seedCategories, runPlanned } from './modules/money/store.ts';
import { scanVault } from './modules/brain/store.ts';
import { autoFinishStale, dueRest } from './modules/gym/store.ts';
import { seedLocalFoods, documentReminders, wishlistReady } from './modules/extras/store.ts';
import { applyRateAnswers, rateFreshnessAsk } from './modules/thrift/store.ts';
import { gradesDaily } from './modules/grades/store.ts';
import { loadPlugins } from './plugins/index.ts';

getDb();
restoreTimer();
// Community plugins before the app is built, so their routes and tools exist. A broken plugin is logged and skipped.
await loadPlugins();

// Phase 2 boot: seed asks + categories, index the vault. Each step fails alone.
const safe = (name: string, fn: () => unknown) => { try { return fn(); } catch (e) { console.error(`${name}:`, (e as Error)?.message ?? e); } };
safe('seedAsks', seedAsks);
safe('seedCategories', seedCategories);
safe('scanVault', () => scanVault());
safe('seedLocalFoods', () => seedLocalFoods());

// Gentle reminders: document expiry (60/30 days, once each) and wishlist items past their cool-off.
const gentle = () => {
  const docs = (safe('documentReminders', () => documentReminders()) ?? []) as { name: string; days_left: number; message?: string }[];
  for (const d of docs) push({ title: 'Document date', message: d.message ?? `${d.name}: ${d.days_left} days left.`, priority: 3, cat: 'docs', key: `doc:${d.name}` }).catch(() => {});
  const wishes = (safe('wishlistReady', () => wishlistReady()) ?? []) as { name: string }[];
  for (const w of wishes) push({ title: 'Wishlist', message: `${w.name}: cool-off is over. Still want it? Decide in the app.`, priority: 2, cat: 'wishlist' }).catch(() => {});
};

// Every 5 min: vault index, stale workouts, planned payments. Rest timer every 15 s (push once when due).
setInterval(() => {
  safe('scanVault', () => scanVault());
  safe('autoFinishStale', () => autoFinishStale());
  safe('runPlanned', () => runPlanned());
  // Inbox compost once a life-day: 30-day-old untouched inbox items go to Someday (tag composted). Silent.
  // Money rate: apply answered rate asks every tick; check rate age once a life-day (one app ask, no push).
  safe('applyRateAnswers', () => applyRateAnswers());
  safe('rateFreshnessAsk', () => { const d = lifeToday(); if (kvGet('ratecheck:last') !== d) { rateFreshnessAsk(d); kvSet('ratecheck:last', d); } });
  safe('compost', () => { const d = lifeToday(); if (kvGet('compost:last') !== d) { compost(); kvSet('compost:last', d); } });
  safe('gradesDaily', () => { const d = lifeToday(); if (kvGet('grades:last') !== d) { gradesDaily(d); kvSet('grades:last', d); } });
  gentle();
}, 5 * 60_000).unref();
setInterval(() => {
  const t = safe('dueRest', () => dueRest()) as { label: string } | null | undefined;
  if (t) push({ title: 'Rest done', message: t.label || 'Next set', priority: 4, cat: 'gym', key: 'rest', ttlMin: 5 }).catch(() => {});
}, 15_000).unref();
// Every minute: task / block reminders, scheduled pushes, morning brief; then held pushes (quiet hours, mode,
// rest day, burst, retry) go out at the next allowed minute. Aligned to the minute so a 15:28 heads-up lands at :00.
const minuteTick = () => { remindersTick().catch(() => {}).finally(() => { flushHeld().catch(() => {}); }); };
setTimeout(() => { minuteTick(); setInterval(minuteTick, 60_000).unref(); }, 60_000 - (Date.now() % 60_000) + 1_000).unref();

const server = serve({ fetch: buildApp().fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  console.log(`mosaic-api listening on http://127.0.0.1:${info.port}`);
});

const stop = (sig: string) => {
  console.log(`${sig}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', (e as Error)?.message ?? e));
