import { createStore } from './store';
import { BRAND } from './brand';

/**
 * Where the API lives and how this build signs in.
 * - Same origin (served by the API itself): HttpOnly cookie, server login page.
 * - Remote API (VITE_API_BASE set): in-app sign-in screen and a Bearer token in localStorage.
 * - Mock and demo builds: no backend and no sign-in; every call is answered in the browser.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
export const TOKEN_MODE = API_BASE !== '';

const KEY = 'mosaic.token';

function read(): string | null {
  if (!TOKEN_MODE) return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const session = createStore({ token: read(), needLogin: TOKEN_MODE && !read() });

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: token lives in memory for this run */
  }
  session.set({ token, needLogin: TOKEN_MODE && !token });
}

export function authHeaders(): Record<string, string> {
  const t = session.get().token;
  return TOKEN_MODE && t ? { Authorization: `Bearer ${t}` } : {};
}

export const url = (path: string) => API_BASE + path;

/** Session ended (401). Remote API: drop the token and show the in-app login. Same origin: server login page. */
export function sessionLost() {
  // The in-browser mock has no session to lose; never bounce to a login page that does not exist.
  if (import.meta.env.VITE_MOCK === '1') return;
  if (TOKEN_MODE) {
    setToken(null);
    return;
  }
  location.assign('/login?next=' + encodeURIComponent('/' + location.hash));
}

const EMAIL_KEY = 'mosaic.email';

/** The email last used to sign in on this device. Not a secret; it prefills Login and shows in Settings. */
export function lastEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* storage blocked: nothing to remember */
  }
}

/** The one message for a rejected sign-in. It never says which field was wrong. */
export const NO_MATCH = 'That did not match. Check the code and try again.';

export async function signIn(email: string, password: string, code: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, code }),
      credentials: 'omit',
    });
  } catch {
    return `No connection to ${BRAND.name}. Check your internet.`;
  }
  const b = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
  if (res.ok && b?.token) {
    rememberEmail(email);
    setToken(b.token);
    return null;
  }
  if (res.status === 401) return NO_MATCH;
  return b?.message ?? `Sign-in failed (${res.status}).`;
}

export async function signOut() {
  if (import.meta.env.VITE_MOCK === '1') return;
  if (!TOKEN_MODE) {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = '/logout';
    document.body.appendChild(f);
    f.submit();
    return;
  }
  await fetch(url('/api/auth/logout'), { method: 'POST', headers: authHeaders(), credentials: 'omit' }).catch(() => {});
  setToken(null);
}
