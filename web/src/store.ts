import { useEffect, useRef, useSyncExternalStore } from 'react';

export type Store<T extends object> = {
  get(): T;
  set(patch: Partial<T>): void;
  sub(fn: () => void): () => void;
};

export function createStore<T extends object>(init: T): Store<T> {
  let state = init;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k in patch) if (patch[k] !== state[k]) changed = true;
      if (!changed) return;
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    sub(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export function useStore<T extends object>(s: Store<T>): T {
  return useSyncExternalStore(s.sub, s.get);
}

/** Network state shown in the offline banner. */
export const net = createStore({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  reachable: true,
  cachedAt: null as string | null,
  queued: 0,
  outbox: 0,
  deadLetters: 0,
});

export type ToastItem = {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
  timeout: number;
};

export const toasts = createStore({ items: [] as ToastItem[] });
let toastSeq = 0;

export function toast(text: string, opts: { action?: ToastItem['action']; timeout?: number; sticky?: boolean } = {}): number {
  const id = ++toastSeq;
  // One toast on screen at a time (the last item). A new message replaces the current one,
  // except sticky ones (the update prompt), which wait underneath and show again afterwards.
  const keep = toasts.get().items.filter((t) => t.sticky);
  toasts.set({ items: [...keep, { id, text, action: opts.action, sticky: opts.sticky, timeout: opts.timeout ?? 4000 }] });
  return id;
}

/** Toast with an Undo action, open for 7 s. `undo` runs at most once. */
export function toastUndo(text: string, undo: () => void, label = 'Undo'): number {
  let used = false;
  const id = toast(text, {
    timeout: 7000,
    action: {
      label,
      run: () => {
        if (used) return;
        used = true;
        dismissToast(id);
        undo();
      },
    },
  });
  return id;
}

/** Data topics. A write calls emit(topic); any screen showing that data reloads (useRefresh). */
export type Topic = 'tasks' | 'money' | 'food' | 'gym' | 'body' | 'notes' | 'blocks' | 'habits' | 'goals' | 'car';
const topicSubs = new Map<Topic, Set<() => void>>();

export function emit(...topics: Topic[]) {
  for (const t of topics) topicSubs.get(t)?.forEach((f) => f());
}

export function onTopic(topic: Topic, fn: () => void): () => void {
  let set = topicSubs.get(topic);
  if (!set) topicSubs.set(topic, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** Reload when another screen changes this topic. Pass a stable or changing fn; the latest is used. */
export function useRefresh(topic: Topic | Topic[], reload: () => void) {
  const ref = useRef(reload);
  ref.current = reload;
  const list = Array.isArray(topic) ? topic : [topic];
  const sig = list.join(',');
  useEffect(() => {
    const offs = (sig.split(',') as Topic[]).map((t) => onTopic(t, () => ref.current()));
    return () => offs.forEach((o) => o());
  }, [sig]);
}

export function dismissToast(id: number) {
  toasts.set({ items: toasts.get().items.filter((t) => t.id !== id) });
}

/** True when any textarea or text input holds text the person typed (used to block reloads). */
export function hasUnsavedText(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLTextAreaElement>('textarea[data-draft], input[data-draft]'),
  ).some(
    (t) => t.value.trim().length > 0,
  );
}
