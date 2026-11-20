import { useEffect, useState } from 'react';
import { createStore } from './store';

/** Look, sound and voice preferences. Per device, kept in localStorage. */
export type ThemeId = 'system' | 'light' | 'dark';
export type SoundPack = 'soft' | 'off';
export type VoiceLang = 'en-US' | 'fr-FR' | 'ar-SA';

export type Prefs = {
  theme: ThemeId;
  sound: SoundPack;
  volume: number; // 0..1, fixed (no slider); kept so old saved prefs still read
  haptics: boolean;
  voiceLang: VoiceLang;
  speakTimer: boolean;
  rate: number; // speech rate 0.7..1.4
  fullHome: boolean; // Today ignores the night and rest-day short view
  /** Prefs schema. 2 = sound off by default, one chime pack. */
  v?: number;
};

export const THEMES: { id: ThemeId; name: string; help: string; dark: boolean; swatch: [string, string, string] }[] = [
  { id: 'system', name: 'System', help: 'Follows the device: light by day, dark after dark.', dark: false, swatch: ['#F6F7F9', '#12151A', '#0F766E'] },
  { id: 'light', name: 'Light', help: 'Calm off-white. Best in daylight.', dark: false, swatch: ['#F6F7F9', '#12151A', '#0F766E'] },
  { id: 'dark', name: 'Dark', help: 'Quiet dark. Easy on the eyes at night.', dark: true, swatch: ['#0C0E12', '#E7EAEE', '#2DD4BF'] },
];

/** Old theme ids (from older builds) map onto light or dark. */
const LEGACY_THEME: Record<string, ThemeId> = { paper: 'light', sahara: 'light', night: 'dark', terminal: 'dark', lantern: 'dark', synthwave: 'dark' };

const KEY = 'mosaic.prefs';
const DEFAULTS: Prefs = { theme: 'system', sound: 'off', volume: 0.6, haptics: true, voiceLang: 'en-US', speakTimer: true, rate: 1, fullHome: false, v: 2 };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Prefs> & { thumb?: unknown };
      const p: Prefs & { thumb?: unknown } = { ...DEFAULTS, ...saved };
      delete p.thumb; // dead pref, nothing read it
      const id = String(p.theme);
      p.theme = LEGACY_THEME[id] ?? (THEMES.some((t) => t.id === id) ? (id as ThemeId) : 'system');
      // Before v2 sound was on out of the box, so a saved 'soft' was rarely a choice: start quiet once.
      // Old packs (typewriter, arcade) are gone; they read as Soft after that.
      if ((saved.v ?? 1) < 2) p.sound = 'off';
      else if (p.sound !== 'off') p.sound = 'soft';
      p.volume = DEFAULTS.volume;
      p.v = 2;
      return p;
    }
  } catch {
    /* storage blocked or bad JSON: defaults */
  }
  return DEFAULTS;
}

export const prefs = createStore<Prefs>(load());

prefs.sub(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs.get()));
  } catch {
    /* storage blocked: prefs last for this visit */
  }
});

const darkMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function isDark(theme: ThemeId = prefs.get().theme): boolean {
  if (theme === 'system') return !!darkMq?.matches;
  return THEMES.find((t) => t.id === theme)?.dark ?? false;
}

/** Puts the theme on <html> (data-theme, read by native.ts) and paints the browser chrome. Mantine's scheme is set in main.tsx. */
export function applyTheme() {
  const dark = isDark(prefs.get().theme);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const bg = dark ? '#0C0E12' : '#F6F7F9';
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.content = bg;
  });
  window.dispatchEvent(new Event('mosaic:theme'));
}

/** The resolved scheme, re-read when prefs or the OS change. */
export function useScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(() => isDark());
  useEffect(() => {
    const read = () => setDark(isDark());
    window.addEventListener('mosaic:theme', read);
    return () => window.removeEventListener('mosaic:theme', read);
  }, []);
  return dark ? 'dark' : 'light';
}

let lastTheme = prefs.get().theme;
prefs.sub(() => {
  const t = prefs.get().theme;
  if (t !== lastTheme) {
    lastTheme = t;
    applyTheme();
  }
});
darkMq?.addEventListener?.('change', () => {
  if (prefs.get().theme === 'system') applyTheme();
});

/** Swap themes with a circular reveal from the point that was tapped (View Transitions where supported). */
export function setTheme(theme: ThemeId, from?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
  if (!doc.startViewTransition || reduce || !from) {
    prefs.set({ theme });
    return;
  }
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  const vt = doc.startViewTransition(() => {
    prefs.set({ theme });
  });
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
        { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
}
