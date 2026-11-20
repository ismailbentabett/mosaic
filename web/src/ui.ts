import { createStore } from './store';

export type SettingsSection = 'mode' | 'look' | 'sound' | 'voice' | 'google' | 'status' | 'app' | 'links';
export type GoogleResult = { ok: boolean; reason: string | null };

import { go } from './router';

/** Global sheets: the mode switch, quick capture and shortcuts. `google` holds the OAuth result for the Settings page. */
export const ui = createStore({
  google: null as GoogleResult | null,
  mode: false,
  capture: false,
  /** Quick add preset: a type id from parseQuick (or null = Auto) and starting text. */
  captureType: null as string | null,
  captureText: '',
  keys: false,
});

const SECTIONS: SettingsSection[] = ['mode', 'look', 'sound', 'voice', 'google', 'status', 'app', 'links'];
export const isSection = (s: string | null): s is SettingsSection => !!s && (SECTIONS as string[]).includes(s);

/** Settings is a page: `#/settings`, or `#/settings?section=…` to jump to one part. */
export function openSettings(section: SettingsSection | null = null, google: GoogleResult | null = null) {
  ui.set({ google: google ?? ui.get().google, mode: false, capture: false, keys: false });
  go(section ? `/settings?section=${section}` : '/settings');
}

export const openMode = () => ui.set({ mode: true });
export const closeMode = () => ui.set({ mode: false });
export const openQuickCapture = (type: string | null = null, text = '') => ui.set({ capture: true, captureType: type, captureText: text, keys: false });
export const closeQuickCapture = () => ui.set({ capture: false, captureType: null, captureText: '' });
/** Every mic door lands here: the assistant chat, voice on, listening. The chat module loads on demand. */
export const openVoice = () => void import('./features/brain/chat').then((m) => m.talkToAssistant());
export const openKeys = () => ui.set({ keys: true });
export const closeKeys = () => ui.set({ keys: false });

/**
 * The Google callback lands on `#/settings?google=ok|error&reason=…`.
 * Keep the result in the store and swap the URL for `#/settings?section=google`, so a reload does not repeat it.
 */
export function consumeSettingsHash(): boolean {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  if (path !== 'settings') return false;
  const p = new URLSearchParams(query);
  const g = p.get('google');
  if (!g) return true;
  ui.set({ google: { ok: g === 'ok', reason: p.get('reason') } });
  history.replaceState(null, '', `${location.pathname}${location.search}#/settings?section=google`);
  return true;
}

/** Last known mode, shared by Today's chip, the mode sheet and Settings. */
export const modeNow = createStore({ mode: null as import('./api').Mode | null });
