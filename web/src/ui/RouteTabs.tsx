// Router-driven tabs for screens with nested routes: the tab is the first path segment under `base`.
// One implementation for every tab row in the app (RouteTabs, SubTabs, Settings).
import { Tabs } from '@mantine/core';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { STROKE, type AppIcon } from '../app/icons';
import { replace } from '../router';

const INDEX = '__index';

export type TabDef = { id: string; label: string; icon: AppIcon };

/** The first sub-path segment under `base` ('' = index). */
export function useSubPath(base: string): string {
  const { pathname } = useLocation();
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return rest.replace(/^\/+/, '').split('/')[0] ?? '';
}

/**
 * A horizontal row that scrolls when it does not fit: fades the clipped edge (so it reads as "more this way")
 * and keeps the active item (`[data-active]` or `[aria-selected=true]`) in view.
 */
export function ScrollRow({ children, active, className }: { children: ReactNode; active?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.toggleAttribute('data-fade-start', el.scrollLeft > 4);
    el.toggleAttribute('data-fade-end', max - el.scrollLeft > 4);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hit = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], [data-active="true"], [data-active=""], [data-checked], input:checked');
    const sel = hit instanceof HTMLInputElement ? (hit.closest<HTMLElement>('label, .mantine-Chip-root') ?? hit.parentElement) : hit;
    if (sel) {
      const left = sel.offsetLeft - el.offsetLeft;
      const target = left - (el.clientWidth - sel.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: 'instant' as ScrollBehavior });
    }
    fade();
    const ro = new ResizeObserver(fade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, fade]);
  return (
    <div ref={ref} className={className ? `tabs-scroll ${className}` : 'tabs-scroll'} onScroll={fade}>
      {children}
    </div>
  );
}

/** Tabs whose value is the sub-path. The first tab is the index route. Switching replaces history. */
export function RouteTabs({ base, tabs }: { base: string; tabs: TabDef[] }) {
  const sub = useSubPath(base);
  const current = tabs.some((t) => t.id === sub) ? sub : tabs[0].id;
  // Mantine needs a non-empty tab value; the index route's id is ''.
  const val = (id: string) => id || INDEX;
  return (
    <ScrollRow active={current}>
      <Tabs
        value={val(current)}
        onChange={(v) => {
          const id = v === INDEX ? '' : v;
          if (v === null || id === current) return;
          replace(id === tabs[0].id ? base : `${base}/${id}`);
        }}
      >
        <Tabs.List style={{ flexWrap: 'nowrap', width: 'max-content', minWidth: '100%' }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <Tabs.Tab key={val(id)} value={val(id)} leftSection={<Icon size={18} stroke={STROKE} />} style={{ whiteSpace: 'nowrap' }}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
    </ScrollRow>
  );
}
