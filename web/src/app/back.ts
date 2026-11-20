import { useEffect, useRef } from 'react';

/**
 * Overlay stack for the Android back button (and Escape on desktop through Mantine itself).
 * Every open sheet / drawer / modal registers a close function; back closes the top one first.
 */
type Entry = { id: number; close: () => void };
const stack: Entry[] = [];
let seq = 0;

export function pushOverlay(close: () => void): () => void {
  const entry = { id: ++seq, close };
  stack.push(entry);
  return () => {
    const i = stack.findIndex((e) => e.id === entry.id);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Closes the top overlay. False when none is open. */
export function closeTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top.close();
  return true;
}

export const overlayOpen = () => stack.length > 0;

/** Registers `onClose` on the back stack while `opened` is true. */
export function useOverlayBack(opened: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!opened) return;
    return pushOverlay(() => ref.current());
  }, [opened]);
}
