// Feature parity gate for the v3 UI. OLD_CALLS is every client call the v2 UI made (screens/, components/,
// app.tsx), frozen on 2026-11-12 so the gate still works after those files are deleted. Each call must
// still be made somewhere in the v3 code, or have a named replacement in MOVED.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OLD_CALLS = [
  'api.appendNote', 'api.chat', 'api.chats', 'api.conflicts', 'api.createTask', 'api.mustDone',
  'api.noteFile', 'api.notesRecent', 'api.notesSearch', 'api.patchTask', 'api.pauseTimer',
  'api.resolveConflict', 'api.resumeTimer', 'api.run', 'api.saveNote', 'api.setMode', 'api.startTimer',
  'api.stopRun', 'api.stopTimer', 'api.tasks', 'api.timer', 'api.today', 'grades.addMilestone',
  'grades.clearDayRating', 'grades.create', 'grades.dayRating', 'grades.finish', 'grades.fromTemplate',
  'grades.history', 'grades.milestoneDone', 'grades.patterns', 'grades.pause', 'grades.quarterExport',
  'grades.quiet', 'grades.quietDismiss', 'grades.quietStart', 'grades.rateDay', 'grades.reopen',
  'grades.repace', 'grades.resume', 'grades.setTarget', 'grades.shrink', 'grades.templates', 'grades.tree',
  'grades.update', 'grades.week', 'grades.whatIf', 'life.addHelped',
  'life.capsules', 'life.capsulesDue', 'life.carryForward', 'life.habitat',
  'life.helpedTop', 'life.keepPromise', 'life.lastDone',
  'life.lent', 'life.occasionsSoon', 'life.openCapsule', 'life.peopleDue',
  'life.promisesSoon', 'life.recurring', 'life.removed', 'life.restore', 'life.returnLent',
  'life.shopGroups', 'life.skip', 'life.skipped', 'life.stamp',
  'life.touch', 'life.waitingDue', 'life.weekFacts', 'life.writeCapsule', 'v2.active', 'v2.addCard',
  'v2.addDocument', 'v2.addHabit', 'v2.addQuestion', 'v2.addShopping', 'v2.addWish', 'v2.afford',
  'v2.answerAsk', 'v2.answerQuestion', 'v2.asks', 'v2.badDay', 'v2.body', 'v2.brain', 'v2.brainDump',
  'v2.brainDumpCommit', 'v2.budgets', 'v2.cardQueue', 'v2.checkHabit', 'v2.clearRest', 'v2.clearShopping',
  'v2.closeDay', 'v2.closeDayState', 'v2.compost', 'v2.counts', 'v2.deleteCard', 'v2.deleteDocument',
  'v2.deleteLog', 'v2.deleteMetric', 'v2.deleteRecord', 'v2.deleteSet', 'v2.deleteWish', 'v2.documents',
  'v2.done', 'v2.doneList', 'v2.draftCard', 'v2.dropQuestion', 'v2.endRescue', 'v2.estimateHint',
  'v2.estimates', 'v2.exercises', 'v2.finishWorkout', 'v2.fits', 'v2.foodDay', 'v2.foodSearch',
  'v2.forgetDevice', 'v2.goalValue', 'v2.habits', 'v2.life', 'v2.logFood', 'v2.logMetric', 'v2.logSet',
  'v2.mergeTask', 'v2.metrics', 'v2.nextSet', 'v2.park', 'v2.parked', 'v2.patchDocument', 'v2.patchTask',
  'v2.priceMemory', 'v2.projects', 'v2.questions', 'v2.quickAdd', 'v2.quickLog', 'v2.records',
  'v2.removeTask', 'v2.reopen', 'v2.rescue', 'v2.restore', 'v2.restoreCompost', 'v2.reviewCard',
  'v2.routines', 'v2.runway', 'v2.savings', 'v2.screentime', 'v2.seedLocalFoods', 'v2.setBadDay',
  'v2.setDay', 'v2.shopping', 'v2.skip', 'v2.skipAsk', 'v2.startWorkout', 'v2.summary', 'v2.tasks',
  'v2.todayRoutine', 'v2.toggleShopping', 'v2.triage', 'v2.triageDecide', 'v2.water', 'v2.weather',
  'v2.wishStatus', 'v2.wishlist', 'v2.workouts',
];

/** Old call -> the v3 call that does the same job. */
const MOVED: Record<string, string> = {
  'api.tasks': 'v2.tasks', // the old /api/tasks screen became the v2 task store
  'api.createTask': 'v2.addTask',
  'api.patchTask': 'v2.patchTask',
  'api.timer': 'api.startTimer', // Today reads the running timer from the today payload; start/stop stay
  'v2.shopping': 'moneyApi.shopping', // shopping lives in features/money/api.ts
  'v2.addShopping': 'moneyApi.addShopping',
  'v2.clearShopping': 'moneyApi.clearDone',
  'grades.history': 'grades.week', // critique #46: the 8-week letter strip is gone; Review shows one week's facts + change
  'v2.doneList': 'grades.doneLog', // critique #45: Done reads the done-log (day/week/month lines + month totals)
};

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIRS = ['features', 'app', 'ui'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const code = [...DIRS.flatMap((d) => walk(join(ROOT, d))), join(ROOT, 'main.tsx')].map((p) => readFileSync(p, 'utf8')).join('\n');
const used = (call: string) => new RegExp(`\\b${call.replace('.', '\\.')}\\b`).test(code);

describe('v3 feature parity', () => {
  it('makes every call the old UI made', () => {
    const missing = OLD_CALLS.filter((c) => !used(MOVED[c] ?? c));
    expect(missing).toEqual([]);
  });
});
