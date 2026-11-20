// Google OAuth + REST via plain fetch. Access token cached in memory; refresh token lives in secrets.env.
import { randomBytes } from 'node:crypto';
import { PUBLIC_URL, cfg, secret, setSecret } from './config.ts';
import { getDb, kvGet, kvSet } from './db.ts';
import { AppError, fail } from './errors.ts';
import { today } from './time.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets';
const STATE_TTL_MS = 15 * 60 * 1000;
const redirectUri = () => `${PUBLIC_URL}/api/google/callback`;

let cached: { token: string; exp: number; refresh: string } | null = null;

export const googleConnected = () =>
  !!(secret('GOOGLE_CLIENT_ID') && secret('GOOGLE_CLIENT_SECRET') && secret('GOOGLE_REFRESH_TOKEN'));

const client = () => {
  const id = secret('GOOGLE_CLIENT_ID');
  const sec = secret('GOOGLE_CLIENT_SECRET');
  if (!id || !sec) fail('google_not_connected', 'Google client id/secret not set: run mosaic-connect google on the VPS.');
  return { id: id as string, sec: sec as string };
};

export const googleAuthUrl = () => {
  const { id } = client();
  const db = getDb();
  db.prepare('DELETE FROM oauth_state WHERE created < ?').run(new Date(Date.now() - STATE_TTL_MS).toISOString());
  const state = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_state (state, created) VALUES (?, ?)').run(state, new Date().toISOString());
  const q = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${AUTH_URL}?${q}`;
};

const postToken = async (body: Record<string, string>) => {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    return fail('upstream', 'Google token endpoint unreachable.');
  }
  const j: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
};

export const googleCallback = async (code: string, state: string) => {
  const db = getDb();
  const row = db.prepare('SELECT created FROM oauth_state WHERE state = ?').get(String(state ?? '')) as { created: string } | undefined;
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(String(state ?? ''));
  if (!row || Date.now() - Date.parse(row.created) > STATE_TTL_MS) fail('bad_request', 'OAuth state invalid or expired: start Connect Google again.');
  if (!code) fail('bad_request', 'No authorization code from Google: start Connect Google again.');
  const { id, sec } = client();
  const r = await postToken({ code, client_id: id, client_secret: sec, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  if (!r.ok) fail('upstream', `Google token exchange failed: ${r.j.error_description || r.j.error || r.status}`);
  if (!r.j.refresh_token)
    fail('bad_request', 'Google sent no refresh token. Remove the app at myaccount.google.com/permissions, then Connect Google again.');
  setSecret('GOOGLE_REFRESH_TOKEN', r.j.refresh_token);
  cached = r.j.access_token
    ? { token: r.j.access_token, exp: Date.now() + (Number(r.j.expires_in) || 3600) * 1000, refresh: r.j.refresh_token }
    : null;
};

const authExpired = async (): Promise<never> => {
  cached = null;
  const key = `push:google_auth_expired:${today()}`;
  if (!kvGet(key)) {
    kvSet(key, '1');
    try {
      const { push } = await import('./ntfy.ts');
      await push({ title: 'Google disconnected', message: 'Calendar access expired. Settings → Reconnect Google.', priority: 4, cat: 'ops', key: 'google' });
    } catch { /* push is best effort */ }
  }
  throw new AppError('google_auth_expired', 'Google access expired or revoked: Settings → Reconnect Google.');
};

const accessToken = async (): Promise<string> => {
  const refresh = secret('GOOGLE_REFRESH_TOKEN');
  const { id, sec } = client();
  if (!refresh) return fail('google_not_connected', 'Google not connected: Settings → Connect Google.');
  if (cached && cached.refresh === refresh && cached.exp - 60_000 > Date.now()) return cached.token;
  const r = await postToken({ refresh_token: refresh, client_id: id, client_secret: sec, grant_type: 'refresh_token' });
  if (r.j.error === 'invalid_grant') return authExpired();
  if (!r.ok || !r.j.access_token) return fail('upstream', `Google token refresh failed: ${r.j.error_description || r.j.error || r.status}`);
  cached = { token: r.j.access_token, exp: Date.now() + (Number(r.j.expires_in) || 3600) * 1000, refresh };
  return cached.token;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON fetch against a Google REST URL. One retry on 429/5xx, one token refresh on 401. */
export const googleFetch = async (url: string, init: RequestInit = {}): Promise<any> => {
  let retried = false;
  let reauthed = false;
  for (;;) {
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch {
      if (!retried) { retried = true; await sleep(800); continue; }
      return fail('upstream', 'Google API unreachable.');
    }
    if (res.status === 401 && !reauthed) { reauthed = true; cached = null; continue; }
    if ((res.status === 429 || res.status >= 500) && !retried) {
      retried = true;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 5) * 1000 : 800);
      continue;
    }
    const text = await res.text();
    let j: any = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    if (res.ok) return j;
    const msg = j?.error?.message || j?.error_description || `HTTP ${res.status}`;
    if (j?.error === 'invalid_grant') return authExpired();
    if (res.status === 404 || res.status === 410) return fail('not_found', `Google: ${msg}`);
    return fail('upstream', `Google API error ${res.status}: ${msg}`);
  }
};

export const checkGoogle = async (): Promise<{ ok: boolean; message: string }> => {
  if (!googleConnected()) return { ok: false, message: 'Google not connected: Settings → Connect Google.' };
  try {
    const cal = encodeURIComponent(cfg('GOOGLE_CALENDAR_ID', 'primary'));
    await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?maxResults=1`);
    return { ok: true, message: 'Google connected.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Google check failed.' };
  }
};
