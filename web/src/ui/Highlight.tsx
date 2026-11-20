import type { ReactNode } from 'react';

/**
 * Search highlighting. The server marks FTS hits with «…»; those markers are never shown raw.
 * Marked spans become <mark class="hl">. Stray, unmatched « or » are dropped.
 * With no markers, an optional `query` is highlighted case-insensitively instead.
 */

const MARK = /«([^«»]*)»/g;

/** Plain text with all markers removed (for aria labels, titles and tooltips). */
export function stripMarks(text: string | null | undefined): string {
  return (text ?? '').replace(/[«»]/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text into plain and highlighted pieces. Exported for the Markdown renderer. */
export function highlightParts(text: string, query?: string): ReactNode[] {
  const src = text ?? '';
  const out: ReactNode[] = [];
  if (src.includes('«') || src.includes('»')) {
    let last = 0;
    let k = 0;
    const re = new RegExp(MARK.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m.index > last) out.push(stripMarks(src.slice(last, m.index)));
      if (m[1]) out.push(<mark key={`m${k++}`} className="hl">{m[1]}</mark>);
      last = m.index + m[0].length;
    }
    if (last < src.length) out.push(stripMarks(src.slice(last)));
    return out;
  }
  const words = (query ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map(escapeRe);
  if (!words.length) return [src];
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  const parts = src.split(re);
  parts.forEach((p, i) => {
    if (!p) return;
    out.push(i % 2 === 1 ? <mark key={`q${i}`} className="hl">{p}</mark> : p);
  });
  return out;
}

export function Highlight({ text, query }: { text: string | null | undefined; query?: string }) {
  return <>{highlightParts(text ?? '', query)}</>;
}
