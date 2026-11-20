import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { watchKeyboard } from './device';

/**
 * True while the screen is visible. Routed screens unmount when hidden (no tab stack), so this is
 * always true while mounted; it pauses on a hidden browser tab so clocks and polls stop.
 */
export function usePageActive(): boolean {
  const [active, setActive] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const read = () => setActive(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, []);
  return active;
}

/** Ticks while active. */
export function useNow(active: boolean, ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/**
 * True while the on-screen keyboard is open. native.ts (`watchKeyboard`) sets `body.kb-open`;
 * this mirrors it so the shell can hide the bottom bar.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => typeof document !== 'undefined' && document.body.classList.contains('kb-open'));
  useEffect(() => {
    watchKeyboard();
    const body = document.body;
    const read = () => setOpen(body.classList.contains('kb-open'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return open;
}

export { useLoad, act } from './ui/data';

/** Query string of the current route. The argument is kept for old call sites. */
export function usePageSearch(_pathname?: string): string {
  return useLocation().search;
}
