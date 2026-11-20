import { haptic, reducedMotion } from './feel';
import type { HapticKind } from './device';
import { prefs, type SoundPack } from './prefs';

/**
 * Tiny synth: every sound is made on the fly with Web Audio, so there are no files to load.
 *
 * Public API (one entry point for every screen):
 *   feel.done()  feel.tap()  feel.error()  feel.undo()  feel.capture() …
 *   feel('done')            same thing, older call style, still supported
 *   feel('done', 'soft')    preview (Settings)
 * Each call plays one short Soft sound and a light haptic, both gated by the Feel prefs
 * (sound 'off' = silent, the default; haptics toggle = no vibration). Reduce motion keeps feedback minimal:
 * celebratory events collapse to the plain done/tap cue and vibrations stay short.
 * 'tab' stays in the type for old callers but is silent: switching a view is not an event.
 * This is the only haptic API (the old `buzz()` is gone).
 */
export type FeelEvent =
  | 'tap'
  | 'tab'
  | 'done'
  | 'undo'
  | 'capture'
  | 'timerStart'
  | 'timerEnd'
  | 'allDone'
  | 'error'
  | 'micOn'
  | 'micOff'
  | 'theme';

type Ctx = AudioContext;
let ctx: Ctx | null = null;

function audio(): Ctx | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

// Browsers start audio suspended until a gesture; wake it on the first one.
if (typeof window !== 'undefined') {
  const wake = () => {
    if (prefs.get().sound === 'off' && !ctx) return;
    const c = audio();
    if (c && c.state === 'suspended') void c.resume();
  };
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
}

type Voice = { type: OscillatorType; freq: number; to?: number; at?: number; dur: number; gain?: number; attack?: number };

// Longest one-shot patch (soft timerEnd) is about 1.7s; the per-call bus is released after this.
const BUS_LIFE_MS = 2500;

function out(c: Ctx): GainNode {
  const g = c.createGain();
  g.gain.value = prefs.get().volume * 0.5;
  g.connect(c.destination);
  // Detach the bus once its voices have ended so repeated cues do not pile up nodes on the graph.
  setTimeout(() => {
    try {
      g.disconnect();
    } catch {
      /* already detached */
    }
  }, BUS_LIFE_MS);
  return g;
}

function tone(c: Ctx, dest: AudioNode, v: Voice) {
  const t0 = c.currentTime + (v.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = v.type;
  o.frequency.setValueAtTime(v.freq, t0);
  if (v.to) o.frequency.exponentialRampToValueAtTime(v.to, t0 + v.dur);
  const peak = v.gain ?? 0.6;
  const a = v.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + v.dur + 0.02);
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };

type Patch = (c: Ctx, o: AudioNode) => void;

const PACKS: Record<Exclude<SoundPack, 'off'>, Partial<Record<FeelEvent, Patch>>> = {
  // Rounded sine blips. The only pack: present but quiet. Sound is off until he turns it on.
  soft: {
    tap: (c, o) => tone(c, o, { type: 'sine', freq: 880, dur: 0.05, gain: 0.25 }),
    done: (c, o) => {
      tone(c, o, { type: 'sine', freq: N.E5, dur: 0.12, gain: 0.5 });
      tone(c, o, { type: 'sine', freq: N.A5, at: 0.07, dur: 0.22, gain: 0.5 });
    },
    undo: (c, o) => tone(c, o, { type: 'sine', freq: 700, to: 420, dur: 0.16, gain: 0.35 }),
    capture: (c, o) => tone(c, o, { type: 'sine', freq: 500, to: 1100, dur: 0.14, gain: 0.35 }),
    timerStart: (c, o) => {
      tone(c, o, { type: 'sine', freq: N.C5, dur: 0.1, gain: 0.4 });
      tone(c, o, { type: 'sine', freq: N.G5, at: 0.09, dur: 0.18, gain: 0.4 });
    },
    timerEnd: (c, o) => {
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(c, o, { type: 'sine', freq: f, at: i * 0.14, dur: 0.6, gain: 0.45 }));
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(c, o, { type: 'sine', freq: f, at: 1 + i * 0.14, dur: 0.6, gain: 0.35 }));
    },
    // A settled chord, not a fanfare: same family as done, a touch fuller.
    allDone: (c, o) => {
      tone(c, o, { type: 'sine', freq: N.E5, dur: 0.14, gain: 0.45 });
      tone(c, o, { type: 'sine', freq: N.A5, at: 0.07, dur: 0.3, gain: 0.4 });
      tone(c, o, { type: 'sine', freq: N.E6, at: 0.07, dur: 0.3, gain: 0.12 });
    },
    error: (c, o) => {
      tone(c, o, { type: 'triangle', freq: 220, dur: 0.12, gain: 0.4 });
      tone(c, o, { type: 'triangle', freq: 185, at: 0.11, dur: 0.18, gain: 0.4 });
    },
    micOn: (c, o) => tone(c, o, { type: 'sine', freq: 600, to: 900, dur: 0.1, gain: 0.3 }),
    micOff: (c, o) => tone(c, o, { type: 'sine', freq: 900, to: 600, dur: 0.1, gain: 0.3 }),
    theme: (c, o) => tone(c, o, { type: 'sine', freq: 300, to: 1200, dur: 0.35, gain: 0.25, attack: 0.05 }),
  },
};

/** Haptic per event. Missing = no vibration (tab switches, theme, mic off stay silent to the hand). */
const HAPTIC: Partial<Record<FeelEvent, HapticKind>> = {
  tap: 'tap',
  done: 'done',
  undo: 'tap',
  capture: 'done',
  timerStart: 'tap',
  timerEnd: 'long',
  allDone: 'done',
  error: 'error',
  micOn: 'tap',
};

/** Under reduce motion, celebratory or decorative cues fall back to their plain counterpart. */
const CALM: Partial<Record<FeelEvent, FeelEvent | null>> = {
  allDone: 'done',
  theme: null,
};

// Rapid repeats (double taps, list re-renders) would stack into noise; one cue per event per window.
const GAP_MS = 45;
const lastAt: Partial<Record<FeelEvent, number>> = {};

function play(event: FeelEvent, pack: SoundPack) {
  if (pack === 'off') return;
  // Background tabs stay quiet, except the timer end: that cue exists to reach someone looking elsewhere.
  if (event !== 'timerEnd' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const patch = PACKS[pack][event];
  if (!patch) return;
  const c = audio();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume();
    patch(c, out(c));
  } catch {
    /* audio failed: stay silent */
  }
}

/** Plays the sound for an event in the chosen pack, plus a haptic when haptics are on. */
function feelEvent(event: FeelEvent, pack: SoundPack = prefs.get().sound) {
  let ev: FeelEvent | null = event;
  if (reducedMotion() && ev in CALM) ev = CALM[ev] ?? null;
  if (!ev) return;
  const now = Date.now();
  if (now - (lastAt[ev] ?? 0) < GAP_MS) return;
  lastAt[ev] = now;
  const p = prefs.get();
  const kind = HAPTIC[ev];
  if (p.haptics && kind) haptic(kind === 'long' && reducedMotion() ? 'done' : kind);
  play(ev, pack);
}

type FeelApi = typeof feelEvent & { readonly [K in FeelEvent]: () => void };

const EVENTS: FeelEvent[] = ['tap', 'tab', 'done', 'undo', 'capture', 'timerStart', 'timerEnd', 'allDone', 'error', 'micOn', 'micOff', 'theme'];

/**
 * `feel.done()`, `feel.tap()`, `feel.error()` … or `feel('done')`. Sound and haptic, gated by the
 * Feel prefs and reduce motion. Safe to call anywhere: never throws, silent when unsupported.
 */
export const feel: FeelApi = Object.assign(
  feelEvent,
  Object.fromEntries(EVENTS.map((e) => [e, () => feelEvent(e)])) as Record<FeelEvent, () => void>,
);

/* ---------- Focus noise: looped brown or pink noise, made on the fly. ---------- */
export type NoiseKind = 'brown' | 'pink';
let noiseSrc: AudioBufferSourceNode | null = null;
let noiseGain: GainNode | null = null;
let noiseKind: NoiseKind | null = null;
const NOISE_KEY = 'mosaic.focusNoise';

function noiseBuffer(c: Ctx, kind: NoiseKind): AudioBuffer {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    // Paul Kellet's economy pink filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  // Fade the loop seam so it doesn't click.
  const fade = Math.min(2000, len >> 4);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] *= k;
    d[len - 1 - i] *= k;
  }
  return buf;
}

/** Starts looped focus noise; volume follows the app volume, quieter than the effects. */
export function startNoise(kind: NoiseKind) {
  stopNoise();
  const c = audio();
  if (!c) return;
  try {
    if (c.state === 'suspended') void c.resume();
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, kind);
    src.loop = true;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, prefs.get().volume * 0.35), c.currentTime + 1.5);
    src.connect(g).connect(c.destination);
    src.start();
    noiseSrc = src;
    noiseGain = g;
    noiseKind = kind;
    try {
      localStorage.setItem(NOISE_KEY, kind);
    } catch {
      /* storage blocked */
    }
  } catch {
    /* audio failed: stay silent */
  }
}

/** Fades out and stops focus noise. `forget` also clears the remembered choice. */
export function stopNoise(forget = false) {
  const c = ctx;
  if (noiseSrc && noiseGain && c) {
    const src = noiseSrc;
    try {
      noiseGain.gain.cancelScheduledValues(c.currentTime);
      noiseGain.gain.setValueAtTime(Math.max(0.0001, noiseGain.gain.value), c.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
      src.stop(c.currentTime + 0.45);
    } catch {
      /* already stopped */
    }
  }
  noiseSrc = null;
  noiseGain = null;
  noiseKind = null;
  if (forget) {
    try {
      localStorage.removeItem(NOISE_KEY);
    } catch {
      /* storage blocked */
    }
  }
}

export const playingNoise = (): NoiseKind | null => noiseKind;
export function rememberedNoise(): NoiseKind | null {
  try {
    const v = localStorage.getItem(NOISE_KEY);
    return v === 'brown' || v === 'pink' ? v : null;
  } catch {
    return null;
  }
}
