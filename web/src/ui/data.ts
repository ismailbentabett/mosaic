// Data loading for every screen: stale-while-revalidate useLoad and the act() write helper.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { asApiError, type ApiError } from '../api';
import { toast } from '../store';
import { feel } from '../sound';

/** Background refetches in flight (data already on screen). Drives the thin refresh line at the top. */
let inflight = 0;
const inflightSubs = new Set<() => void>();
function bump(d: number) {
  inflight = Math.max(0, inflight + d);
  inflightSubs.forEach((f) => f());
}
/** True while any screen is refreshing data it already shows. */
export function useRefreshing(): boolean {
  return useSyncExternalStore(
    (f) => {
      inflightSubs.add(f);
      return () => inflightSubs.delete(f);
    },
    () => inflight > 0,
  );
}

/** Pull to refresh fires this; every active useLoad reloads. */
export const PULL_EVENT = 'mosaic:pull';

/** Last good value per `key`, shared across mounts so a revisited screen paints at once (stale-while-revalidate). */
const loadCache = new Map<string, unknown>();

/**
 * Load data while the page is active; keeps the last good value on refresh.
 * With `{ key }` the value is cached in memory: the next mount shows it immediately (`stale` true)
 * while a fresh fetch runs (`refreshing` true). `loading` is only true when there is nothing to show.
 */
export function useLoad<T>(fn: () => Promise<T>, active: boolean, deps: unknown[] = [], opts: { key?: string } = {}) {
  const key = opts.key;
  const [data, setDataState] = useState<T | null>(() => (key && loadCache.has(key) ? (loadCache.get(key) as T) : null));
  const [stale, setStale] = useState(() => !!key && loadCache.has(key));
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(() => active && !(key && loadCache.has(key)));
  const [at, setAt] = useState<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);
  const dataRef = useRef<T | null>(data);
  dataRef.current = data;
  const setData = useCallback((v: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T | null) => T | null)(prev) : v;
      if (keyRef.current) {
        if (next === null) loadCache.delete(keyRef.current);
        else loadCache.set(keyRef.current, next);
      }
      return next;
    });
  }, []);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    if (dataRef.current === null) setError(null);
    setBusy(true);
    const bg = dataRef.current !== null;
    if (bg) bump(1);
    try {
      const v = await fnRef.current();
      if (n !== seq.current) return;
      setData(v);
      setStale(false);
      setError(null);
      setAt(Date.now());
    } catch (e) {
      if (n === seq.current) setError(asApiError(e));
    } finally {
      if (bg) bump(-1);
      if (n === seq.current) setBusy(false);
    }
  }, [setData]);
  useEffect(() => {
    if (active) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reload, ...deps]);
  useEffect(() => {
    if (!active) return;
    const on = () => void reload();
    window.addEventListener(PULL_EVENT, on);
    return () => window.removeEventListener(PULL_EVENT, on);
  }, [active, reload]);
  const loading = busy && data === null;
  const refreshing = busy && data !== null;
  return { data, error, loading, refreshing, stale, reload, setData, at };
}

/** Run a write, show the API's message on failure, return the result or null. */
export async function act<T>(p: Promise<T>, okText?: string): Promise<T | null> {
  try {
    const v = await p;
    if (okText) {
      toast(okText);
      feel.tap();
    }
    return v;
  } catch (e) {
    toast(asApiError(e).message);
    feel.error();
    return null;
  }
}

