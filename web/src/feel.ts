import type { HapticKind } from './device';

/**
 * Low-level feel helpers: reduce-motion detection and haptics. The public event API
 * (`feel.done()`, `feel.tap()`, `feel.error()`, `feel('capture')` …) lives in `sound.ts`,
 * which layers the sound packs on top of these and gates both on the Feel prefs.
 */

/** True when the OS asks for reduced motion or the in-app Reduce motion setting is on (`html.reduce-motion`). */
export function reducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Web vibration pattern per kind, in ms. Kept short: a confirmation, never an alarm, except `long`. */
const WEB_PATTERN: Record<HapticKind, number | number[]> = {
  tap: 8,
  done: 14,
  error: [18, 60, 18],
  long: 40,
};

/** One physical confirmation. `navigator.vibrate` where supported, silent elsewhere. */
export function haptic(kind: HapticKind = 'tap') {
  try {
    navigator.vibrate?.(WEB_PATTERN[kind]);
  } catch {
    /* blocked by the browser or no vibration motor */
  }
}
