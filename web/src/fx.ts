import { reducedMotion } from './feel';

/**
 * Quiet visual acknowledgements. No confetti, no particles, no streak animations (REDESIGN section 6):
 * - burst(el): one soft ring settles out of the element (completion), --dur-4, transform + opacity only.
 * - floatText(el, text): a short word rises a few pixels and fades (e.g. "Saved").
 * Both are skipped under reduce motion (OS setting or the in-app toggle). Colours are Mantine variables, which the live app defines.
 */
let layer: HTMLDivElement | null = null;

function overlay(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  // Inline essentials so the layer works even if its stylesheet rules move.
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '100000', pointerEvents: 'none', overflow: 'hidden' });
  document.body.appendChild(layer);
  return layer;
}

function easeOut(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
}

function canAnimate(el: Element | null): el is Element {
  return !!el && typeof document !== 'undefined' && !reducedMotion() && typeof (el as HTMLElement).animate === 'function';
}

/**
 * Completion acknowledgement from an element (task done). Signature kept from the old particle
 * burst; `opts` is accepted and ignored so existing callers keep compiling.
 */
export function burst(el: Element | null, _opts: { count?: number; spread?: number } = {}) {
  if (!canAnimate(el)) return;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  // Ring sized to the smaller side of the element (a checkbox, a row's tick), capped so rows stay calm.
  const size = Math.max(24, Math.min(56, Math.min(r.width, r.height)));
  const ring = document.createElement('span');
  Object.assign(ring.style, {
    position: 'absolute',
    left: `${r.left + r.width / 2 - size / 2}px`,
    top: `${r.top + r.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    border: '2px solid var(--mantine-color-green-6)',
    opacity: '0',
    willChange: 'transform, opacity',
  });
  overlay().appendChild(ring);
  const anim = ring.animate(
    [
      { transform: 'scale(0.6)', opacity: 0.55 },
      { transform: 'scale(1.35)', opacity: 0 },
    ],
    { duration: 420, easing: easeOut() },
  );
  const done = () => ring.remove();
  anim.onfinish = done;
  anim.oncancel = done;
}

/** A short word that rises from a point and fades (e.g. "Saved" after a capture). */
export function floatText(el: Element | null, text: string) {
  if (!canAnimate(el)) return;
  const r = el.getBoundingClientRect();
  const p = document.createElement('span');
  p.className = 'fx-float';
  p.textContent = text;
  Object.assign(p.style, {
    position: 'absolute',
    left: `${r.left + r.width / 2}px`,
    top: `${r.top}px`,
    // Neutral text colour: signal orange is reserved for "now".
    color: 'var(--mantine-color-dimmed)',
    fontSize: 'var(--mantine-font-size-sm)',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    opacity: '0',
    willChange: 'transform, opacity',
  });
  overlay().appendChild(p);
  const a = p.animate(
    [
      { transform: 'translate(-50%, 0)', opacity: 0 },
      { transform: 'translate(-50%, -8px)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%, -16px)', opacity: 0 },
    ],
    { duration: 420, easing: easeOut() },
  );
  const done = () => p.remove();
  a.onfinish = done;
  a.oncancel = done;
}
