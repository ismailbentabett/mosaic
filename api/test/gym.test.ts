import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'mosaic-gym-'));
process.env.MOSAIC_ROOT = root;
process.env.MOSAIC_VAULT = join(root, 'vault');
process.env.MOSAIC_DATA = join(root, 'data');
process.env.MOSAIC_DB = join(root, 'data', 'test.db');
mkdirSync(join(root, 'vault'), { recursive: true });

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e: any) { return e.code; } };
const g = await import('../src/modules/gym/store.ts');

const lib = [
  { id: 'Barbell_Bench_Press_-_Medium_Grip', name: 'Barbell Bench Press - Medium Grip', equipment: 'barbell', category: 'strength', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], instructions: ['Lie down.'], images: ['a/0.jpg'] },
  { id: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell', category: 'strength', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes'] },
  { id: 'Pullups', name: 'Pullups', equipment: 'body only', category: 'strength', primaryMuscles: ['lats'] },
  { id: 'Running', name: 'Running, Treadmill', equipment: 'machine', category: 'cardio', primaryMuscles: ['quadriceps'] },
];
const bench = 'Barbell Bench Press - Medium Grip';

test('e1rm, warm-up, plates', () => {
  assert.equal(g.e1rm(100, 1), 100);
  assert.equal(g.e1rm(100, 10), 133.3);
  assert.equal(g.e1rm(100, 13), null);
  assert.deepEqual(g.warmup(100).map((s) => s.weight), [40, 60, 80]);
  const p = g.plates(102.5);
  assert.deepEqual(p.per_side, [25, 15, 1.25]);
  assert.equal(p.remainder, 0);
});

test('library import, own exercises, archive with history', () => {
  const r = g.importExercises(lib);
  assert.equal(r.added, 4);
  assert.equal(g.importExercises(lib).added, 0);
  assert.equal(g.findExercise('pullups')?.kind, 'reps');
  assert.equal(g.findExercise('Running, Treadmill')?.kind, 'distance_time');
  const own = g.addExercise({ name: 'Cable fly', primary_muscles: ['chest'] });
  assert.equal(code(() => g.addExercise({ name: 'cable fly' })), 'bad_request');
  assert.equal(g.removeExercise(own.id), 'deleted');
});

test('workout: one active, sets, PRs, rest timer, progression, volume', () => {
  g.addRoutine({ name: 'Push A', items: [{ exercise: bench, sets: 3, rep_min: 8, rep_max: 10, rest_s: 90 }] });
  const w = g.startWorkout({ routine: 'Push A', at: '2026-11-09T19:30:00Z' });
  assert.equal(w.name, 'Push A');
  assert.equal(code(() => g.startWorkout({ at: '2026-11-09T19:31:00Z' })), 'conflict');
  const wu = g.logSet({ workout_id: w.id, exercise: bench, type: 'warmup', weight: 100, reps: 5, at: '2026-11-09T19:35:00Z' });
  assert.equal(wu.prs.length, 0); // warm-ups never set PRs
  const s1 = g.logSet({ id: 'set-00000001', workout_id: w.id, exercise: bench, weight: 60, reps: 10, at: '2026-11-09T19:40:00Z' });
  assert.equal(s1.prs.length, 0); // first-ever session sets a baseline, not a PR
  assert.equal(g.logSet({ id: 'set-00000001', workout_id: w.id, exercise: bench, weight: 99, reps: 1 }).prs.length, 0);
  g.logSet({ workout_id: w.id, exercise: bench, weight: 60, reps: 10, at: '2026-11-09T19:43:00Z' });
  g.logSet({ workout_id: w.id, exercise: bench, weight: 60, reps: 10, at: '2026-11-09T19:46:00Z' });
  assert.ok(g.getRest());
  assert.equal(code(() => g.logSet({ workout_id: w.id, exercise: bench, weight: 60 })), 'bad_request');
  assert.equal(code(() => g.logSet({ workout_id: w.id, exercise: bench, weight: 60, reps: 5, rpe: 11 })), 'bad_request');

  const done = g.finishWorkout(w.id, '', new Date('2026-11-09T20:30:00Z'));
  assert.equal(done.working_sets, 3);
  assert.equal(done.volume_kg, 1800);
  assert.equal(g.listPrs(bench).find((p) => p.kind === 'heaviest')?.value, 60);
  assert.deepEqual(done.prs, []); // nothing to beat yet

  const next = g.suggestNext(bench, 8, 10);
  assert.equal(next.weight, 62.5);
  assert.equal(next.reps, 8);
  const hold = g.suggestNext(bench, 8, 12);
  assert.equal(hold.weight, 60);

  const vol = g.muscleVolume('2026-11-09');
  assert.equal(vol.find((v: any) => v.muscle === 'chest')?.sets, 3);
  assert.equal(vol.find((v: any) => v.muscle === 'triceps')?.sets, 1.5);
  assert.equal(g.removeExercise(g.findExercise(bench)!.id), 'archived');
});

test('PRs need an earlier session; labels are readable', () => {
  const w2 = g.startWorkout({ at: '2026-11-11T19:30:00Z' });
  const same = g.logSet({ workout_id: w2.id, exercise: 'Barbell Squat', weight: 80, reps: 5, at: '2026-11-11T19:35:00Z', rest_s: 0 });
  assert.equal(same.prs.length, 0); // first squat session: baseline only
  const up = g.logSet({ workout_id: w2.id, exercise: bench, weight: 62.5, reps: 10, at: '2026-11-11T19:40:00Z', rest_s: 0 });
  const kinds = up.prs.map((p: any) => p.kind).sort();
  assert.deepEqual(kinds, ['e1rm', 'heaviest', 'volume']); // reps@62.5 is new, so no earlier value to beat
  assert.equal(up.prs.find((p: any) => p.kind === 'heaviest')?.previous, 60);
  assert.equal(up.prs.find((p: any) => p.kind === 'heaviest')?.label, 'Heaviest weight');
  const more = g.logSet({ workout_id: w2.id, exercise: bench, weight: 62.5, reps: 11, at: '2026-11-11T19:44:00Z', rest_s: 0 });
  assert.ok(more.prs.some((p: any) => p.kind === 'reps@62.5' && p.label === 'Most reps at 62.5 kg'));
  const fin = g.finishWorkout(w2.id, '', new Date('2026-11-11T20:30:00Z'));
  assert.ok(fin.prs.length > 0);
  assert.ok(fin.prs.every((p: any) => p.exercise_name === bench)); // squat baseline is not listed
  assert.equal(g.prLabel('reps@0'), 'Most reps');
  assert.equal(g.suggestNext(bench, 8, 12, true).weight, 57.5); // ~90% of 62.5, on the plate step
});

test('stale workout auto-finishes at last set + 2 min', () => {
  const w = g.startWorkout({ at: '2026-11-10T19:00:00Z' });
  g.logSet({ workout_id: w.id, exercise: 'Pullups', reps: 8, at: '2026-11-10T19:10:00Z', rest_s: 0 });
  assert.equal(g.autoFinishStale(new Date('2026-11-10T21:00:00Z')), 0);
  assert.equal(g.autoFinishStale(new Date('2026-11-10T23:00:00Z')), 1);
  assert.equal(g.getWorkout(w.id).ended_at, '2026-11-10T19:12:00.000Z');
});

test('Strong + Hevy imports are idempotent', () => {
  const strong = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n' +
    '2026-10-01 18:00:00,Legs,1h 5m,Squat (Barbell),1,100,5,,,,,\n' +
    '2026-10-01 18:00:00,Legs,1h 5m,Squat (Barbell),2,100,5,,,,,8\n' +
    '2026-10-01 18:00:00,Legs,1h 5m,Nordic Curl,1,0,6,,,,,';
  const r = g.importStrong(strong);
  assert.equal(r.added, 1);
  assert.equal(r.sets, 3);
  assert.ok(r.created_exercises.includes('Nordic Curl'));
  assert.equal(g.importStrong(strong).added, 0);

  const hevy = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n' +
    'Pull,"3 Nov 2026, 19:30","3 Nov 2026, 20:30",,Pullups,,,0,normal,,10,,,\n' +
    'Pull,"3 Nov 2026, 19:30","3 Nov 2026, 20:30",,Pullups,,,1,warmup,,5,,,';
  const h = g.importHevy(hevy);
  assert.equal(h.added, 1);
  assert.equal(h.sets, 2);
  assert.equal(g.importHevy(hevy).added, 0);
  assert.equal(code(() => g.importHevy('a,b\n1,2')), 'bad_request');
});
