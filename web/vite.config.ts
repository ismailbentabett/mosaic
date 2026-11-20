import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

/**
 * Bundle budget: the build fails when start-up JS (entry + its static imports) or any lazy screen
 * chunk grows past its gzip limit. Target first-load is 180 kB; the gate sits just above today's size
 * so it catches regressions while vendor is split down. Shared lazy libraries (charts) are exempt.
 */
const BUDGET = { firstLoadKb: 330, routeKb: 60, exempt: ['charts'] };
/** The demo build also ships the in-browser mock backend (lazy, loaded once on start), so its chunk gets its own limit. */
const DEMO_BUDGET = { mockKb: 120 };
function bundleBudget(mode: string): Plugin {
  const demo = mode === 'demo' || mode === 'mock';
  return {
    name: 'mosaic-bundle-budget',
    apply: 'build',
    generateBundle(_o, bundle) {
      const kb = (code: string) => gzipSync(code).length / 1024;
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk') as Array<{ fileName: string; name: string; code: string; isEntry: boolean; imports: string[]; facadeModuleId: string | null }>;
      const byFile = new Map(chunks.map((c) => [c.fileName, c]));
      const errs: string[] = [];
      for (const entry of chunks.filter((c) => c.isEntry)) {
        const seen = new Set<string>();
        const walk = (f: string) => {
          if (seen.has(f)) return;
          seen.add(f);
          byFile.get(f)?.imports.forEach(walk);
        };
        walk(entry.fileName);
        const total = [...seen].reduce((n, f) => n + kb(byFile.get(f)?.code ?? ''), 0);
        if (total > BUDGET.firstLoadKb) errs.push(`first-load JS ${total.toFixed(1)} kB gzip > ${BUDGET.firstLoadKb} kB`);
      }
      for (const c of chunks) {
        if (c.isEntry || c.name === 'vendor' || BUDGET.exempt.includes(c.name)) continue;
        const size = kb(c.code);
        const isMock = demo && /[\/]src[\/]mock(.ts|[\/])/.test(c.facadeModuleId ?? '');
        if (isMock) {
          if (size > DEMO_BUDGET.mockKb) errs.push(`${c.fileName} ${size.toFixed(1)} kB gzip > ${DEMO_BUDGET.mockKb} kB (demo mock)`);
          continue;
        }
        if (size > BUDGET.routeKb) errs.push(`${c.fileName} ${size.toFixed(1)} kB gzip > ${BUDGET.routeKb} kB`);
      }
      if (errs.length) this.error(['Bundle budget exceeded:', ...errs].join(String.fromCharCode(10) + '  '));
    },
  };
}

const api = process.env.MOSAIC_API_TARGET || readEnvTarget() || 'http://127.0.0.1:8787';
function readEnvTarget(): string | undefined {
  // `vite --mode devapi` reads .env.devapi (only MOSAIC_API_TARGET is used)
  const mode = process.argv[process.argv.indexOf('--mode') + 1];
  if (!process.argv.includes('--mode') || !mode) return undefined;
  const f = join(root, `.env.${mode}`);
  if (!existsSync(f)) return undefined;
  return /^MOSAIC_API_TARGET=(.+)$/m.exec(readFileSync(f, 'utf8'))?.[1]?.trim();
}
// Marks proxied dev requests; the API does not read it.
const devHeaders = { 'X-Dev-User': 'dev@local' };
// The dev page lives on localhost:<port>, the API trusts only its public origin.
// The page and proxy are one origin, so drop the browser's Origin before forwarding.
const sameOrigin = (proxy: { on: (e: 'proxyReq', fn: (req: { removeHeader: (h: string) => void }) => void) => void }) =>
  proxy.on('proxyReq', (req) => req.removeHeader('origin'));

export default defineConfig(({ mode }) => ({
  plugins: [react(), bundleBudget(mode)],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Libraries live apart from app code so app-only updates don't re-download them.
    // Charts (recharts + d3) are only pulled in by the screens that draw one, so they get their
    // own chunk and load on first use instead of at start-up.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Chart and date-picker CSS follow the lazy screens that import them, so start-up skips them.
          if (id.endsWith('.css') && /[\/]@mantine[\/](charts|dates)[\/]/.test(id)) return undefined;
          if (!id.endsWith('.css') && /[\/](recharts|d3-[a-z-]+|victory-vendor|@mantine[\/]charts|decimal\.js-light|eventemitter3|es-toolkit|immer|reselect|@reduxjs|react-redux|redux)[\/]/.test(id)) return 'charts';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: api, headers: devHeaders, configure: sameOrigin },
      '/mcp': { target: api, headers: devHeaders, configure: sameOrigin },
    },
  },
}));
