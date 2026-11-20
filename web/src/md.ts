import { createElement as h, type ReactElement, type ReactNode } from 'react';
type Node0 = ReactElement;
type ComponentChildren = ReactNode;

/**
 * Tiny safe Markdown renderer. Produces React elements only (never an HTML string),
 * so all text is escaped by construction. Supports headings, paragraphs, lists
 * (nested by indent), task checkboxes, blockquotes, rules, fenced and inline code,
 * bold, italic, ~~strike~~, links (http/https/mailto/obsidian/#), [[wikilinks]], GFM tables
 * and search marks («hit» becomes <mark>, never shown raw).
 */

const SAFE_HREF = /^(https?:|mailto:|obsidian:|#)/i;

export function wikiHref(target: string): string {
  return '#/brain/notes/note?wiki=' + encodeURIComponent(target);
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(~~[^~\n]+~~)|(«[^«»\n]*»)/g;

export function inline(src: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE.source, 'g');
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(unmark(src.slice(last, m.index)));
    const tok = m[0];
    if (m[1]) out.push(h('code', { key: m.index }, unmark(tok.slice(1, -1))));
    else if (m[2]) out.push(h('strong', { key: m.index }, inline(tok.slice(2, -2))));
    else if (m[3]) {
      const inner = tok.slice(2, -2);
      const [target, alias] = inner.split('|');
      const name = unmark((target ?? '').split('#')[0]!).trim();
      out.push(h('a', { key: m.index, href: wikiHref(name), className: 'wikilink' }, inline((alias ?? target ?? '').trim())));
    } else if (m[4]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const label = mm?.[1] ?? tok;
      const href = unmark(mm?.[2] ?? '');
      if (SAFE_HREF.test(href)) {
        const ext = /^https?:/i.test(href);
        out.push(h('a', { key: m.index, href, ...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, inline(label)));
      } else out.push(unmark(label));
    } else if (m[5]) out.push(h('em', { key: m.index }, inline(tok.slice(1, -1))));
    else if (m[6]) {
      const href = unmark(tok);
      out.push(h('a', { key: m.index, href, target: '_blank', rel: 'noopener noreferrer' }, href));
    }
    else if (m[7]) out.push(h('del', { key: m.index }, inline(tok.slice(2, -2))));
    else if (m[8]) {
      if (tok.length > 2) out.push(h('mark', { key: m.index, className: 'hl' }, tok.slice(1, -1)));
    }
    last = m.index + tok.length;
  }
  if (last < src.length) out.push(unmark(src.slice(last)));
  return out;
}

/** Drop stray, unmatched search markers. */
function unmark(s: string): string {
  return s.replace(/[«»]/g, '');
}

// ---------- tables ----------
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isTableStart(lines: string[], i: number): boolean {
  const a = lines[i];
  const b = lines[i + 1];
  // The separator must carry a pipe, so "text | more" over a plain "---" rule stays a paragraph and a rule.
  return !!a && !!b && a.includes('|') && b.includes('|') && TABLE_SEP.test(b) && b.includes('-');
}

function renderTable(lines: string[], start: number, key: number): [Node0, number] {
  const head = cells(lines[start]!);
  const align = cells(lines[start + 1]!).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : undefined));
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) rows.push(cells(lines[i++]!));
  const cell = (tag: 'th' | 'td', text: string, c: number) =>
    h(tag, { key: c, style: align[c] ? { textAlign: align[c] } : undefined, ...(tag === 'th' ? { scope: 'col' } : {}) }, inline(text));
  const table = h(
    'table',
    { className: 'md-table' },
    h('thead', null, h('tr', null, head.map((t, c) => cell('th', t, c)))),
    h(
      'tbody',
      null,
      rows.map((r, ri) => h('tr', { key: ri }, head.map((_, c) => cell('td', r[c] ?? '', c)))),
    ),
  );
  return [h('div', { key, className: 'md-table-wrap', tabIndex: 0, role: 'region', 'aria-label': 'Table' }, table), i];
}

type ListItem = { indent: number; ordered: boolean; checked: boolean | null; text: string };
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

function renderList(items: ListItem[], key: number): Node0 {
  // Build nested lists from indentation.
  type Node = { item: ListItem; children: ListItem[] };
  const base = items[0]!.indent;
  const nodes: Node[] = [];
  for (const it of items) {
    if (it.indent > base && nodes.length) nodes[nodes.length - 1]!.children.push(it);
    else nodes.push({ item: it, children: [] });
  }
  const ordered = items[0]!.ordered;
  return h(
    ordered ? 'ol' : 'ul',
    { key, className: nodes.some((n) => n.item.checked !== null) ? 'md-tasks' : undefined },
    nodes.map((n, i) =>
      h(
        'li',
        { key: i, className: n.item.checked === null ? undefined : n.item.checked ? 'md-check done' : 'md-check' },
        n.item.checked === null
          ? null
          : h('span', { className: 'md-box', role: 'img', 'aria-label': n.item.checked ? 'done' : 'not done' }, n.item.checked ? '✓' : ''),
        h('span', null, inline(n.item.text)),
        n.children.length ? renderList(n.children, 0) : null,
      ),
    ),
  );
}

export function renderMarkdown(src: string): Node0 {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Node0[] = [];
  let i = 0;
  let key = 0;
  // Skip YAML front matter.
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) code.push(lines[i++]!);
      i++;
      blocks.push(h('pre', { key: key++ }, h('code', null, unmark(code.join('\n')))));
      continue;
    }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) {
      const level = Math.min(6, hd[1]!.length + 1); // h1 in a note becomes h2 on the page
      blocks.push(h(`h${level}`, { key: key++, className: 'md-h' }, inline(hd[2]!.replace(/\s+#+\s*$/, ''))));
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(h('hr', { key: key++ }));
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const [node, next] = renderTable(lines, i, key++);
      blocks.push(node);
      i = next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push(h('blockquote', { key: key++ }, renderMarkdown(q.join('\n'))));
      continue;
    }
    if (LIST_RE.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (m) {
          items.push({
            indent: m[1]!.replace(/\t/g, '    ').length,
            ordered: /\d/.test(m[2]!),
            checked: m[3] === undefined ? null : m[3].toLowerCase() === 'x',
            text: m[4]!,
          });
          i++;
        } else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) {
          items[items.length - 1]!.text += ' ' + lines[i]!.trim();
          i++;
        } else break;
      }
      blocks.push(renderList(items, key++));
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6})\s/.test(lines[i]!) &&
      !/^\s*(```|~~~|>)/.test(lines[i]!) &&
      !LIST_RE.test(lines[i]!) &&
      !isTableStart(lines, i)
    )
      para.push(lines[i++]!.trim());
    const children: ComponentChildren[] = [];
    para.forEach((p, idx) => {
      if (idx) children.push(h('br'));
      children.push(...inline(p));
    });
    blocks.push(h('p', { key: key++ }, ...children));
  }
  return h('div', { className: 'md' }, blocks);
}
