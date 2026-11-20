// Write helpers shared by Money and Food: deferred delete with Undo, commitWrite, local storage.
import { useCallback, useEffect, useRef, useState } from 'react';
import { asApiError } from '../../api';
import { copy } from '../../copy';
import { feel } from '../../sound';
import { dismissToast, emit, toast, type Topic } from '../../store';

const UNDO_MS = 8000;

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

/** Per-device conveniences only; never required. */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage */
  }
}

/** "1,5" or " 12 " → number (NaN when not a number). */
export const parseNum = (s: string) => Number(s.trim().replace(',', '.'));

/**
 * Delete with Undo and no confirm: the row hides at once, an 8 s toast offers Undo, and the
 * server delete runs when the toast runs out. Leaving the screen or the app sends pending
 * deletes right away. If the delete fails, the row comes back.
 */
export function useDeferredDelete() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const pending = useRef(new Map<string, { timer: number; toast: number; run: () => Promise<unknown>; topic: Topic }>());
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
