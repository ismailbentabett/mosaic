// Device helpers for the web app: shared text, the on-screen keyboard and opening links.
// Mosaic is a website only; there is no native shell.

/** Joins shared title/text/url, dropping parts already contained in a longer one. */
export function shareText(raw: (string | null | undefined)[]): string {
  const parts = raw.map((s) => (s ?? '').trim()).filter((s, i, all) => s && all.indexOf(s) === i);
  return parts.filter((s, i) => !parts.some((o, j) => j !== i && o.length > s.length && o.includes(s))).join('\n');
}

export const SHARE_KEY = 'mosaic.share';
export const SHARE_EVENT = 'mosaic:share';

/** Hands shared text to quick add (read by takeShared on #/capture, or live via the event). */
export function deliverShare(text: string) {
  if (!text) return;
  try {
    sessionStorage.setItem(SHARE_KEY, text);
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(SHARE_EVENT));
}

export type HapticKind = 'tap' | 'done' | 'error' | 'long';

/* ---------- On-screen keyboard: toggles body.kb-open (read by useKeyboardOpen) ---------- */

let kbWatching = false;

function setKeyboard(open: boolean, height = 0) {
  const body = document.body;
  if (!body) return;
  if (body.classList.contains('kb-open') !== open) body.classList.toggle('kb-open', open);
  // Set on <body>, not <html>: the status-bar observer watches <html>.
  const h = open && height > 0.5 ? `${Math.round(height)}px` : '0px';
  if (body.style.getPropertyValue('--kb-h') !== h) body.style.setProperty('--kb-h', h);
}

const NON_TEXT = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];

function isEditable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NON_TEXT.includes(el.type) && !el.readOnly && !el.disabled;
  return false;
}

/** The focused element, looking through shadow roots (some Ionic parts render inputs inside one). */
function activeEl(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Visible height in layout px. Pinch zoom shrinks visualViewport.height by its scale; a keyboard does not. */
function visibleHeight(): number {
  const vv = window.visualViewport;
  return vv ? vv.height * (vv.scale || 1) : window.innerHeight;
}

/**
 * Fallback: the visible height drops well below the tallest height seen while an editable has focus.
 * Runs on touch devices only; a mouse-only desktop has no on-screen
 * keyboard, and resizing its window while a field has focus must not read as one.
 */
function watchViewport() {
  const touch = (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches);
  if (!touch) return;
  const vv = window.visualViewport;
  let base = Math.max(window.innerHeight, visibleHeight());
  let width = window.innerWidth;
  let raf = 0;
  const check = () => {
    raf = 0;
    const h = visibleHeight();
    // A keyboard never changes the width: a new width (rotation, split screen) means a new baseline.
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      base = Math.max(h, window.innerHeight);
    }
    const editing = isEditable(activeEl());
    // Android resizes the layout too (adjustResize), so the baseline is the tallest height seen; it resets on blur.
    base = editing ? Math.max(base, h) : Math.max(h, window.innerHeight);
    const gap = base - h;
    // What the keyboard hides of the layout viewport: 0 when the page itself shrank (Android app, adjustResize),
    // the keyboard height when only the visual viewport shrank (Chrome's default, iOS). Fixed sheets lift by this.
    const cover = vv && Math.abs((vv.scale || 1) - 1) < 0.01 ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : gap;
    // 120px rules out browser toolbars collapsing; real keyboards are 200px or more.
    setKeyboard(editing && gap > 120, cover);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(check);
  };
  const settle = () => {
    schedule();
    // The keyboard animates after focus changes; look again once it has settled.
    setTimeout(schedule, 350);
  };
  vv?.addEventListener('resize', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(schedule, 300));
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
  schedule();
}

/** Starts keyboard tracking once (visualViewport). Idempotent; called by initDevice and by useKeyboardOpen. */
export function watchKeyboard() {
  if (kbWatching || typeof window === 'undefined' || typeof document === 'undefined') return;
  kbWatching = true;
  watchViewport();
}

export function initDevice() {
  watchKeyboard();
}

/** Opens a URL in a new tab. */
export function openExternal(url: string) {
  window.open(url, '_blank', 'noopener');
}
