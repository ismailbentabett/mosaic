import type { NavigateFunction } from 'react-router-dom';

/**
 * Navigation outside React components (shortcuts, Spotlight, Markdown links, stores, voice).
 * The shell binds react-router's navigate once mounted; before that, plain hash changes are used.
 * Routes are hash based (`#/today`), so the share target and `mosaic://` deep links keep working.
 */
let nav: NavigateFunction | null = null;

export function bindNavigate(n: NavigateFunction | null) {
  nav = n;
}

export function go(path: string) {
  if (nav) void nav(path);
  else location.hash = '#' + path;
}

/** Replace the current entry (consume one-shot params like ?run= or ?wiki=). */
export function replace(path: string) {
  if (nav) void nav(path, { replace: true });
  else history.replaceState(null, '', '#' + path);
}

/** Top-level destination (bottom bar, sidebar, shortcuts). Same as go; kept for old call sites. */
export function switchTab(path: string) {
  go(path);
}

/** Back to a parent screen without growing the history stack. */
export function back(parent: string) {
  replace(parent);
}

/** The current hash path without its query, e.g. `/brain/notes`. */
export function currentPath(): string {
  const p = location.hash.replace(/^#/, '').split('?')[0];
  return p || '/';
}

/** Ask, the assistant. */
export const ASK_PATH = '/chat';

/** Chat screens: the composer owns the bottom edge, so the phone bottom bar hides. */
export const isChat = (path: string) => path.startsWith('/chat');
