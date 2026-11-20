// UI guardrail: fails on raw font sizes, raw hex colours and numeric style gaps in screen code.
// Real exceptions go in scripts/ui-lint-allow.txt as `path:needle` (one per line).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const allow = readFileSync(new URL('./ui-lint-allow.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const RULES = [
  { name: 'fz-number', re: /\bfz=\{\d/, fix: 'use a size token (fz="xl") or var(--app-fz-*)' },
  { name: 'fontSize-number', re: /fontSize:\s*\d/, fix: 'use a size token' },
  { name: 'raw-hex', re: /(?<![&\w/'"])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?!\/)/, fix: 'use a theme colour or CSS variable' },
  { name: 'gap-number', re: /\bgap:\s*\d/, fix: 'use var(--mantine-spacing-*)' },
];

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'mock') yield* files(p);
    } else if (p.endsWith('.tsx')) yield p;
  }
}

let bad = 0;
for (const file of files(root)) {
  const rel = relative(root, file).split(sep).join('/');
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes("'#/") || line.includes('"#/') || line.includes('`#/')) return;
      for (const r of RULES) {
        if (!r.re.test(line)) continue;
        if (allow.some((a) => { const [p, n] = a.split(/:(.*)/); return rel === p && line.includes(n); })) continue;
        bad++;
        console.log(`src/${rel}:${i + 1}  ${r.name}  ${r.fix}\n    ${line.trim()}`);
      }
    });
}
if (bad) {
  console.log(`\nui-lint: ${bad} problem(s).`);
  process.exit(1);
}
console.log('ui-lint: clean.');
