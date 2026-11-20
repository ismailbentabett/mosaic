import { useMemo, type MouseEvent } from 'react';
import { renderMarkdown } from '../md';
import { go } from '../router';

/** Long documents get a slightly larger first paragraph. Short notes and chat replies do not. */
const LEAD_MIN = 1200;

/**
 * Markdown with in-app `#/…` links routed through the app router (history stays right).
 * - `variant="doc"` (default): reading spacing for notes.
 * - `variant="chat"`: tighter spacing for Ask replies; safe with streaming (partial) text.
 * - `lead`: first paragraph a step larger when the document is long.
 * Search markers («hit») render as <mark>, never raw.
 */
export function Md({ src, className, lead = false, variant = 'doc' }: { src: string; className?: string; lead?: boolean; variant?: 'doc' | 'chat' }) {
  const tree = useMemo(() => renderMarkdown(src), [src]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (href.startsWith('#/') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      go(href.slice(1));
    }
  };
  const cls = ['md', variant === 'chat' ? 'md-chat' : 'md-doc', lead && variant === 'doc' && src.length >= LEAD_MIN ? 'md-lead' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} onClick={onClick}>
      {tree}
    </div>
  );
}
