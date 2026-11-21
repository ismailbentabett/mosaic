// README showcase: frames the screenshots from scripts/screenshots.mjs as a Windows app window and
// Android phones, light and dark. Usage: node scripts/showcase.mjs  → ../docs/showcase/*.png
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(here, '../../docs/screenshots');
const OUT = resolve(here, '../../docs/showcase');
mkdirSync(OUT, { recursive: true });

const img = (name) => `data:image/png;base64,${readFileSync(`${SHOTS}/${name}.png`).toString('base64')}`;
const icon = `data:image/svg+xml;base64,${readFileSync(resolve(here, '../public/icons/icon.svg')).toString('base64')}`;

const THEMES = {
  light: { bg: 'linear-gradient(135deg,#eef2ff 0%,#f0fdfa 55%,#fdf4ff 100%)', bar: '#f3f4f6', barText: '#111827', ink: '#111827', sub: '#4b5563', frame: '#111827', border: 'rgba(17,24,39,.12)' },
  dark: { bg: 'linear-gradient(135deg,#0b1020 0%,#0f172a 55%,#1e1b4b 100%)', bar: '#1f2433', barText: '#e5e7eb', ink: '#f9fafb', sub: '#9ca3af', frame: '#000', border: 'rgba(255,255,255,.10)' },
};

const css = (t) => `
  *{box-sizing:border-box;margin:0}
  body{background:${t.bg};font-family:"Segoe UI",system-ui,sans-serif;color:${t.ink}}
  .win{border-radius:10px;overflow:hidden;border:1px solid ${t.border};box-shadow:0 30px 80px rgba(0,0,0,.35);background:${t.bar}}
  .bar{height:34px;display:flex;align-items:center;gap:8px;padding-left:12px;color:${t.barText};font-size:13px}
  .bar img{width:16px;height:16px}
  .bar .sp{flex:1}
  .bar span.c{width:46px;height:34px;display:grid;place-items:center;font-size:14px;opacity:.8}
  .win > img.shot{display:block;width:100%}
  .phone{background:${t.frame};border-radius:46px;padding:11px;box-shadow:0 30px 70px rgba(0,0,0,.4),inset 0 0 0 2px #333}
  .phone .scr{position:relative;border-radius:36px;overflow:hidden}
  .phone .scr img{display:block;width:100%}
  .phone .cam{position:absolute;top:10px;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#000;box-shadow:0 0 0 2px #1a1a1a}
  .label{margin-top:18px;text-align:center;font-size:20px;font-weight:600}
  .label small{display:block;font-size:15px;font-weight:400;color:${t.sub};margin-top:4px}
`;

const win = (shot, title = 'Mosaic') => `
  <div class="win"><div class="bar"><img src="${icon}"/><b>${title}</b><span class="sp"></span>
  <span class="c">&#8212;</span><span class="c">&#9633;</span><span class="c">&#10005;</span></div>
  <img class="shot" src="${shot}"/></div>`;
const phone = (shot, w) => `<div class="phone" style="width:${w}px"><div class="scr"><img src="${shot}"/><div class="cam"></div></div></div>`;

const pages = {
  // Windows window with a phone in front: "same app, both platforms".
  hero: (th) => ({
    size: [1800, 1080],
    html: `<div style="position:relative;width:1800px;height:1080px">
      <div style="position:absolute;left:70px;top:70px;width:1380px">${win(img(`desktop-today-${th}`))}</div>
      <div style="position:absolute;right:80px;top:150px">${phone(img(`phone-chat-${th}`), 400)}</div></div>`,
  }),
  phones: (th) => ({
    size: [1800, 940],
    html: `<div style="display:flex;gap:44px;justify-content:center;align-items:flex-start;padding:60px 40px">
      ${[['chat', 'Chat', 'Type it, it is logged'], ['today', 'Today', 'Your day at a glance'], ['money', 'Money', 'Every expense, totals'], ['habits', 'Habits', 'One tap check-ins']]
        .map(([n, l, s]) => `<div>${phone(img(`phone-${n}-${th}`), 360)}<div class="label">${l}<small>${s}</small></div></div>`).join('')}</div>`,
  }),
  windows: (th) => ({
    size: [1800, 1250],
    html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:50px;padding:60px 70px">
      ${['chat', 'tasks', 'money', 'gym'].map((n) => win(img(`desktop-${n}-${th}`))).join('')}</div>`,
  }),
};

const browser = await chromium.launch();
for (const th of ['light', 'dark']) {
  for (const [name, make] of Object.entries(pages)) {
    const { size, html } = make(th);
    const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>${css(THEMES[th])}</style><body>${html}</body>`, { waitUntil: 'load' });
    await page.screenshot({ path: `${OUT}/${name}-${th}.png` });
    await page.close();
  }
}
await browser.close();
console.log(`showcase written to ${OUT}`);
