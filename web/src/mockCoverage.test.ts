// Demo gate: every /api/v2 route the UI calls must be answered by the in-browser mock (src/mock), so the
// static demo never shows "no mock for …". Routes are read from the client sources; `${…}` becomes "x".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mockV2 } from './mock/index';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'mock') walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const METHOD: Record<string, string> = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' };

function routes(): { method: string; path: string; file: string }[] {
  const out: { method: string; path: string; file: string }[] = [];
  const norm = (raw: string) => {
    // Innermost {…} first, so nested braces inside an expression go too; "1" stands for an id.
    let s = raw;
    while (/\{[^{}]*\}/.test(s)) s = s.replace(/\{[^{}]*\}/g, '§');
    s = s.replace(/\/\$§/g, '/1').replace(/\$§/g, '');
    // `${cond ? `?a=${a}` : ''}` stops the match at the inner backtick: drop the unfinished tail.
    return s.split('$')[0]!.split('?')[0]!;
  };
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    const short = file.slice(ROOT.length);
    // get('/x'), post<T>(`/x/${id}`), del(...) helpers that prefix /api/v2
    if (/const P = '\/api\/v2'/.test(src)) {
      for (const m of src.matchAll(/\b(get|post|put|patch|del)\s*(?:<[^\n]*?>)?\(\s*([`'"])(\/(?:(?!\2)[^\n])*?)\2/g)) {
        out.push({ method: METHOD[m[1]!]!, path: norm(m[3]!), file: short });
      }
    }
    // request('PUT', `/api/v2/…`) and sendOrQueue('POST', '/api/v2/…')
    for (const m of src.matchAll(/\b(?:request|sendOrQueue)\s*(?:<[^\n]*?>)?\(\s*'(GET|POST|PUT|PATCH|DELETE)',\s*(?:P\s*\+\s*)?([`'"])((?:\/api\/v2)?\/(?:(?!\2)[^\n])*?)\2/g)) {
      const path = norm(m[3]!);
      if (path.startsWith('/api/') && !path.startsWith('/api/v2/')) continue;
      out.push({ method: m[1]!, path: path.replace(/^\/api\/v2/, ''), file: short });
    }
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

describe('demo mock covers the UI', () => {
  const list = routes();
  it('finds the client routes', () => {
    expect(list.length).toBeGreaterThan(100);
  });
  it('answers every /api/v2 route the UI calls', () => {
    const missing = list.filter((r) => {
      // Empty bodies are fine: a route that answers 400/404 is still covered.
      const res = mockV2(r.method, r.path, new URLSearchParams(), {});
      return res === null;
    });
    expect(missing.map((r) => `${r.method} ${r.path}  (${r.file})`)).toEqual([]);
  });
});
