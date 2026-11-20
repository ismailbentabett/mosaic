// README screenshots: renders the demo build (fictional persona) at desktop and phone sizes, light and dark.
// Usage: npm run build:demo && node scripts/screenshots.mjs [baseUrl]
// With no baseUrl it serves dist-demo itself on a free port. Output: ../docs/screenshots/*.png
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../docs/screenshots');
mkdirSync(OUT, { recursive: true });

let server;
let base = process.argv[2];
if (!base) {
  server = await preview({ root: resolve(here, '..'), mode: 'demo', build: { outDir: 'dist-demo' }, preview: { port: 0, open: false } });
  base = server.resolvedUrls.local[0].replace(/\/$/, '');
}

const DESKTOP = [
  ['chat', '/chat'],
  ['today', '/today'],
  ['tasks', '/tasks'],
  ['calendar', '/calendar'],
  ['life', '/life'],
  ['money', '/life/money'],
  ['food', '/life/food'],
  ['gym', '/life/gym'],
  ['goals', '/life/goals'],
  ['brain', '/brain'],
];
const PHONE = [['chat', '/chat'], ['today', '/today'], ['money', '/life/money'], ['habits', '/life/habits']];

async function shoot(ctx, name, route) {
  const page = await ctx.newPage();
  await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.mantine-Skeleton-root[data-visible], [aria-busy="true"]'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  for (const [n, r] of DESKTOP) await shoot(desk, `desktop-${n}-${theme}`, r);
  await desk.close();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, isMobile: true, hasTouch: true });
  for (const [n, r] of PHONE) await shoot(phone, `phone-${n}-${theme}`, r);
  await phone.close();
}
await browser.close();
if (server) await new Promise((ok) => server.httpServer.close(ok));
console.log(`screenshots written to ${OUT}`);
