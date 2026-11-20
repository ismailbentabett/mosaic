import type { SoundPack } from '../../prefs';
import { createStore } from '../../store';

/**
 * Text size and reduce motion. prefs.ts has no fields for these, so they live under their own key
 * (`mosaic.display`, same as before the rebuild) and apply to <html> on import and on every change.
 * Text size sets the root font size, so every Mantine rem scales with it.
 */
export type Pack = Exclude<SoundPack, 'off'>;
type Display = { scale: number; reduceMotion: boolean; lastPack: Pack };

const KEY = 'mosaic.display';
export const SCALE = { min: 90, max: 130, step: 10 };

export function clampScale(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 100;
  const snapped = Math.round(v / SCALE.step) * SCALE.step;
  return Math.min(SCALE.max, Math.max(SCALE.min, snapped));
}

function read(): Display {
  const base: Display = { scale: 100, reduceMotion: false, lastPack: 'soft' };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Display>;
    return {
      scale: clampScale(p.scale),
      reduceMotion: p.reduceMotion === true,
      lastPack: 'soft',
    };
  } catch {
    return base;
  }
}

export const display = createStore<Display>(read());

/** Puts text size and reduce motion on <html>. */
export function applyDisplay(d: Display = display.get()) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.style.setProperty('--app-font-scale', String(d.scale / 100));
  html.style.fontSize = d.scale === 100 ? '' : `${d.scale}%`;
  html.classList.toggle('reduce-motion', d.reduceMotion);
}

display.sub(() => {
  const d = display.get();
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage blocked: the setting lasts for this run */
  }
  applyDisplay(d);
});
applyDisplay();
