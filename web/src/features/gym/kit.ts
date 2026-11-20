// Small helpers shared by the Gym, Body and Habits screens (writes, deferred delete, parsing).
import { useCallback, useEffect, useRef, useState } from 'react';
import { asApiError } from '../../api';
import { copy } from '../../copy';
import * as f from '../../fmt';
import { feel } from '../../sound';
import { dismissToast, emit, toast, type Topic } from '../../store';

export const UNDO_MS = 8000;

/** "72,4" or "72.4" → 72.4. NaN when empty or not a number. */
export const parseNum = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const s = v.trim().replace(',', '.');
  return s ? Number(s) : NaN;
};

/** "8", "8–12" or "" from a rep range. */
export const repRange = (min: number | null | undefined, max: number | null | undefined) =>
  min == null ? '' : max != null && max !== min ? `${f.num(min)}–${f.num(max)}` : f.num(min);

/** "Bench press 60 kg × 8" (body weight when there is no load). */
export const setText = (exercise: string, weight: number | null | undefined, reps: number | null | undefined) =>
  `${exercise} ${weight != null ? f.load(weight) : 'body'} × ${reps != null ? f.num(reps) : f.DASH}`;

/**
 * Run a write. `done` is true when it reached the server or was queued on this phone, so a form
 * can reset either way (a queued save resubmitted would log twice). `r` is the server record,
 * null when queued or failed. Failures toast the calm message and keep the form as typed.
 */
export async function commitWrite<T>(p: Promise<T>): Promise<{ r: T | null; done: boolean }> {
  try {
    return { r: await p, done: true };
  } catch (e) {
    const err = asApiError(e);
    toast(err.message);
    return { r: null, done: err.code === 'queued' };
  }
}

type Pending = { timer: number; toast: number; run: () => Promise<unknown>; topic: Topic };

/**
 * Delete with Undo and no confirm: the row hides at once, an 8 s toast offers Undo, and the
 * server delete runs when the toast runs out. Leaving the screen or the app sends pending
 * deletes right away. If the delete fails, the row comes back.
 */
export function useDeferredDelete() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const pending = useRef(new Map<string, Pending>());
  const unhide = useCallback((id: string) => {
    setHidden((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);
  const commit = useCallback(
    (id: string) => {
      const p = pending.current.get(id);
      if (!p) return;
      pending.current.delete(id);
      window.clearTimeout(p.timer);
      // Sent early (leaving the screen or the app): the Undo in the toast can no longer work.
      dismissToast(p.toast);
      p.run()
        .then(() => emit(p.topic))
        .catch((e) => {
          toast(asApiError(e).message);
          unhide(id);
        });
    },
    [unhide],
  );
  const flush = useCallback(() => {
    for (const id of [...pending.current.keys()]) commit(id);
  }, [commit]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);
  const remove = useCallback(
    (id: string, label: string, run: () => Promise<unknown>, topic: Topic) => {
      if (pending.current.has(id)) return;
      setHidden((s) => new Set(s).add(id));
      feel('tap');
      const tid = toast(`${copy.toast.deleted} · ${label}`, {
        timeout: UNDO_MS,
        action: {
          label: copy.toast.undo,
          run: () => {
            const p = pending.current.get(id);
            if (!p) return;
            pending.current.delete(id);
            window.clearTimeout(p.timer);
            dismissToast(p.toast);
            unhide(id);
            feel('undo');
          },
        },
      });
      const timer = window.setTimeout(() => commit(id), UNDO_MS);
      pending.current.set(id, { timer, toast: tid, run, topic });
    },
    [commit, unhide],
  );
  return { hidden, remove };
}

/** Per-device convenience flag in localStorage. Never required: falls back to `def`. */
export function useLocalFlag(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? def : s === '1';
    } catch {
      return def;
    }
  });
  const set = useCallback(
    (n: boolean) => {
      setV(n);
      try {
        localStorage.setItem(key, n ? '1' : '0');
      } catch {
        /* storage blocked: keep it for this visit only */
      }
    },
    [key],
  );
  return [v, set];
}

// ---- Personal records (same labels as the server's prLabel in api gym/store.ts) ----

/** "Heaviest weight", "Most reps at 60 kg"… for a PR kind (heaviest | e1rm | volume | reps@<kg>). */
export function prLabel(kind: string): string {
  if (kind === 'heaviest' || kind === 'weight') return 'Heaviest weight';
  if (kind === 'e1rm') return 'Best estimated 1-rep max';
  if (kind === 'volume') return 'Best set volume';
  if (kind === 'reps') return 'Most reps';
  const m = /^reps@(.+)$/.exec(kind);
  if (m) return Number(m[1]) > 0 ? `Most reps at ${f.load(Number(m[1]))}` : 'Most reps';
  return kind;
}

/** The PR value with its unit: reps for reps PRs, kg otherwise. */
export const prValue = (kind: string, value: number) =>
  kind === 'reps' || kind.startsWith('reps@') ? f.plural(value, 'rep') : f.load(value);

const PR_ORDER = ['heaviest', 'e1rm', 'volume'];
const prRank = (k: string) => (PR_ORDER.includes(k) ? PR_ORDER.indexOf(k) : PR_ORDER.length);

/** One line for the set toast: "New best · Heaviest weight 62.5 kg". Null when there is none. */
export function prToastLine(prs: { kind: string; value: number; label?: string }[] | null | undefined): string | null {
  if (!prs?.length) return null;
  const top = [...prs].sort((a, z) => prRank(a.kind) - prRank(z.kind))[0];
  return `New best · ${prLabel(top.kind)} ${prValue(top.kind, top.value)}`;
}

/** Finish toast part: "2 new bests (Bench press, Squat)". Null when none. */
export function prFinishLine(prs: { exercise_name?: string; kind: string }[] | null | undefined): string | null {
  if (!prs?.length) return null;
  const names = [...new Set(prs.map((p) => p.exercise_name).filter((x): x is string => !!x))];
  const n = names.length || prs.length;
  return `${f.plural(n, 'new best')}${names.length ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})` : ''}`;
}
