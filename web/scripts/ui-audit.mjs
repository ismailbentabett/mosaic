// UI audit: every route × light/dark × 375/1280 px against the mock dev server.
// DOM rules (tap targets, small text, clipping, headings, names) + axe-core, plus screenshots of key screens.
// Usage: npm run dev:mock (port 5173), then `npm run audit` (or `node scripts/ui-audit.mjs http://localhost:4321`).
// Exit code 1 on any P0 finding. Screenshots and the JSON report go to a new folder under audit-out/.
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const ROUTES = [
  '/chat', '/today', '/tasks', '/tasks/inbox', '/tasks/projects', '/calendar',
  '/life', '/life/money', '/life/money/records', '/life/money/budgets', '/life/food', '/life/gym', '/life/body', '/life/habits',
  '/life/people', '/life/goals', '/life/review', '/life/work', '/life/home', '/life/car',
  '/brain', '/brain/search', '/brain/notes', '/brain/ideas', '/brain/documents', '/brain/cards',
  '/settings', '/dev/ui',
];
const SNAP = ['/chat', '/today', '/tasks', '/calendar', '/life', '/life/money', '/life/food', '/life/gym', '/brain', '/brain/notes'];
const WIDTHS = [375, 1280];
const THEMES = ['light', 'dark'];

const out = `audit-out/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(out, { recursive: true });

/** Runs in the page. Returns findings: { rule, level, text }. */
function domRules(phone) {
  const found = [];
  const add = (rule, level, el, extra = '') => {
    const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
    found.push({ rule, level, text: `${name}${extra}` });
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Off-screen (slid-away drawers) and inert subtrees are not reachable, so they are not measured.
    if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || el.closest('[inert], [aria-hidden="true"]')) return false;
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const interactive = [...document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea, [role="checkbox"], [role="switch"]')].filter(visible);
  for (const el of interactive) {
    // A checkbox or radio is hit through its wrapping label, so measure that.
    const box = (el.matches('input[type="checkbox"], input[type="radio"]') && (el.closest('label') || el.closest('.mantine-Checkbox-body, .mantine-Radio-body, .mantine-Switch-body'))) || el;
    const r = box.getBoundingClientRect();
    // Inputs inside a labelled row are measured by their wrapper; skip tiny native inputs that Mantine hides.
    if (box === el && el.matches('input[type="checkbox"], input[type="radio"]') && getComputedStyle(el).opacity === '0') continue;
    if (phone && (r.height < 32 || r.width < 32)) add('tap-target-<32', 'P0', el, ` ${Math.round(r.width)}×${Math.round(r.height)}`);
    else if (phone && (r.height < 44 || r.width < 44) && !el.closest('.mantine-Tabs-list, .tabs-scroll, p, li span')) add('tap-target-<44', 'P1', el, ` ${Math.round(r.width)}×${Math.round(r.height)}`);
    const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent?.trim() || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('placeholder');
    if (!name) add('no-accessible-name', 'P0', el);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) add('text-<11px', 'P0', el, ` ${fs}px`);
    else if (fs < 12) add('text-<12px', 'P1', el, ` ${fs}px`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) found.push({ rule: 'horizontal-scroll', level: 'P0', text: `${document.documentElement.scrollWidth}px > ${window.innerWidth}px` });
  const h1 = document.querySelectorAll('h1').length;
  if (h1 !== 1) found.push({ rule: 'h1-count', level: 'P1', text: `${h1} h1` });
  for (const img of document.querySelectorAll('img:not([alt])')) add('img-no-alt', 'P0', img);
  return found;
}

const browser = await chromium.launch();
const report = [];
let p0 = 0;
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 812 : 900 }, colorScheme: theme, hasTouch: width < 768, isMobile: width < 768 });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' }).catch(() => {});
      // Wait for lazy chunks and skeletons to settle so a route is measured once, not mid-transition.
      await page.waitForFunction(() => !document.querySelector('.mantine-Skeleton-root[data-visible], [aria-busy="true"]'), null, { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      const dom = await page.evaluate(domRules, width < 768);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().catch(() => ({ violations: [] }));
      const axeFound = axe.violations.map((v) => ({ rule: `axe:${v.id}`, level: v.impact === 'critical' || v.impact === 'serious' ? 'P0' : 'P1', text: `${v.nodes.length} node(s): ${v.help} [${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}]` }));
      const all = [...dom, ...axeFound];
      p0 += all.filter((f) => f.level === 'P0').length;
      report.push({ route, theme, width, findings: all });
      if (SNAP.includes(route)) await page.screenshot({ path: `${out}/${route.slice(1).replace(/\//g, '_')}-${theme}-${width}.png` });
      const n0 = all.filter((f) => f.level === 'P0').length;
      console.log(`${n0 ? 'FAIL' : 'ok  '} ${theme.padEnd(5)} ${String(width).padEnd(4)} ${route}${n0 ? `  (${n0} P0)` : ''}`);
      for (const f of all.filter((x) => x.level === 'P0').slice(0, 8)) console.log(`       ${f.rule}  ${f.text}`);
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${p0} P0 finding(s). Report and screenshots: ${out}/`);
process.exit(p0 ? 1 : 0);
