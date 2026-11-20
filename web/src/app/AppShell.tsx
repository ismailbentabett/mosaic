import { BRAND } from '../brand';
import { ActionIcon, AppShell as MAppShell, Avatar, Badge, Box, Group, Kbd, NavLink, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconMicrophone, IconPlus, IconSearch, IconSettings, IconUser } from '@tabler/icons-react';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { api } from '../api';
import { openCaptureVoice, takeShared } from '../capture';
import { useKeyboardOpen } from '../hooks';
import { SHARE_EVENT } from '../device';
import { bindNavigate, go } from '../router';
import { feel } from '../sound';
import { startStatusPolling } from '../status';
import { useStore } from '../store';
import { modeNow, openMode, openQuickCapture, openSettings, openVoice } from '../ui';
import { Boundary } from '../ui/Boundary';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Loading } from '../ui/Page';
import { usePhone } from '../ui/Sheet';
import { BrandLockup, BrandMark } from './Brand';
import { STROKE } from './icons';
import { BOTTOM, BRAIN, LIFE, MAIN, SETTINGS, labelOf, screenOf, sectionOf, type NavItem } from './navItems';
import { DemoBanner } from './DemoBanner';
import { NetBanner, StatusDot } from './NetBanner';
import { PULL_EVENT, useRefreshing } from '../ui/data';
import { IconArrowDown } from '@tabler/icons-react';
import { Notify } from './Notify';
import { AppRoutes, prefetchRoute } from './routes';
import { Shortcuts } from './Shortcuts';
import { SpotlightHost, openSpotlight } from './SpotlightHost';
import { QuickAdd } from '../features/quickadd/QuickAdd';
import { KeysSheet } from '../features/settings/KeysSheet';
import { ModeSheet } from '../features/settings/ModeSheet';

/** Long press on the + opens quick add with the mic already listening. */
const LONG_PRESS_MS = 500;

const PLACES_KEY = 'mosaic.places';

/** Last path seen per bottom-bar section, so a tab returns where you left it. */
function usePlaces(path: string, search: string) {
  const places = useRef<Record<string, string>>({});
  if (Object.keys(places.current).length === 0) {
    try {
      places.current = JSON.parse(sessionStorage.getItem(PLACES_KEY) ?? '{}') as Record<string, string>;
    } catch {
      places.current = {};
    }
  }
  useEffect(() => {
    const sec = sectionOf(path);
    places.current[sec] = path + search;
    try {
      sessionStorage.setItem(PLACES_KEY, JSON.stringify(places.current));
    } catch {
      /* storage blocked: tabs just open at their root */
    }
  }, [path, search]);
  return places;
}

/** Shows the mode once it is not Normal (phones), always on desktop. Click opens the mode sheet. */
function ModeChip({ phone }: { phone: boolean }) {
  const { mode } = useStore(modeNow);
  useEffect(() => {
    if (modeNow.get().mode) return;
    api
      .mode()
      .then((r) => modeNow.set({ mode: r.mode }))
      .catch(() => {
        /* unknown mode: the chip just stays hidden */
      });
  }, []);
  if (!mode) return null;
  if (phone && mode === 'Normal') return null;
  const color = mode === 'Normal' ? 'gray' : mode === 'Zero' ? 'yellow' : mode === 'Family' ? 'grape' : 'teal';
  return (
    <Tooltip label="Change mode">
      <Badge
        component="button"
        type="button"
        variant="light"
        color={color}
        size="lg"
        radius="md"
        onClick={openMode}
        style={{ cursor: 'pointer', textTransform: 'none' }}
        aria-label={`Mode: ${mode}. Change mode.`}
      >
        {mode}
      </Badge>
    </Tooltip>
  );
}

function Header({ phone, path }: { phone: boolean; path: string }) {
  const title = labelOf(path);
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="sm">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        {phone ? (
          <>
            <UnstyledButton onClick={() => go('/chat')} aria-label="Mosaic, go to Chat" miw={44} mih={44} display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
              <BrandMark size={28} />
            </UnstyledButton>
            <Text fw={650} size="lg" truncate>
              {title ?? 'Mosaic'}
            </Text>
          </>
        ) : (
          <UnstyledButton onClick={() => go('/chat')} aria-label="Mosaic, go to Chat">
            <BrandLockup size={30} />
          </UnstyledButton>
        )}
      </Group>

      {!phone && (
        <UnstyledButton
          onClick={openSpotlight}
          aria-label="Search everything"
          px="sm"
          h={36}
          style={{
            flex: '0 1 420px',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--mantine-spacing-xs)',
            borderRadius: 'var(--mantine-radius-md)',
            border: '1px solid var(--mantine-color-default-border)',
            background: 'var(--app-surface)',
            color: 'var(--mantine-color-dimmed)',
          }}
        >
          <IconSearch size={16} stroke={STROKE} />
          <Text size="sm" c="dimmed" style={{ flex: 1 }}>
            Go to, add, or search…
          </Text>
          <Group gap={2}>
            <Kbd size="xs">Ctrl</Kbd>
            <Kbd size="xs">K</Kbd>
          </Group>
        </UnstyledButton>
      )}

      <Group gap={4} wrap="nowrap">
        <ModeChip phone={phone} />
        {phone && (
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={openSpotlight} aria-label="Search everything">
            <IconSearch size={20} stroke={STROKE} />
          </ActionIcon>
        )}
        <StatusDot />
        {phone && (
          <UnstyledButton onClick={() => openSettings()} aria-label="Settings" miw={44} mih={44} display="flex" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--mantine-radius-xl)' }}>
            <Avatar size={32} radius="xl" color="brand" variant="light" aria-hidden>
              <IconUser size={18} stroke={STROKE} />
            </Avatar>
          </UnstyledButton>
        )}
        {!phone && (
          <>
            <Tooltip label={`Talk to ${BRAND.assistant} (v)`}>
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={openVoice} aria-label={`Talk to ${BRAND.assistant}`}>
                <IconMicrophone size={20} stroke={STROKE} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Settings (,)">
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => openSettings()} aria-label="Settings">
                <IconSettings size={20} stroke={STROKE} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Quick add (c)">
              <ActionIcon color="brand" variant="filled" size="lg" radius="md" onClick={() => openQuickCapture()} aria-label="Quick add" ml={4}>
                <IconPlus size={20} stroke={2} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
      </Group>
    </Group>
  );
}

function NavGroup({ items, path, onPick, nested }: { items: NavItem[]; path: string; onPick: (to: string) => void; nested?: boolean }) {
  return (
    <Stack gap={1} className={nested ? 'nav-nested' : undefined}>
      {items.map((n) => {
        const active = path === n.path || path.startsWith(n.path + '/');
        const I = n.icon;
        return (
          <NavLink
            key={n.id}
            href={'#' + n.path}
            label={n.label}
            active={active}
            aria-current={active ? 'page' : undefined}
            leftSection={<I size={18} stroke={STROKE} />}
            rightSection={n.key ? <Kbd size="xs">{n.key}</Kbd> : undefined}
            onClick={(e) => {
              e.preventDefault();
              onPick(n.path);
            }}
            className="nav-item"
            fw={active ? 600 : 500}
          />
        );
      })}
    </Stack>
  );
}

function Sidebar({ path, onPick }: { path: string; onPick: (to: string) => void }) {
  // The section row ("Life", "Brain") is the hub link; its modules sit indented under it.
  // Hubs are only "active" on their exact path; module items handle the rest.
  const exact = (n: NavItem) => (path === n.path ? path : '');
  const lifeHub: NavItem = { ...BOTTOM[2] };
  const brainHub: NavItem = { ...BOTTOM[3] };
  return (
    <>
      <MAppShell.Section grow component={ScrollArea} px="sm" py="sm">
        <NavGroup items={MAIN} path={path} onPick={onPick} />
        <div className="nav-section">
          <NavGroup items={[lifeHub]} path={exact(lifeHub)} onPick={onPick} />
          <NavGroup items={LIFE} path={path} onPick={onPick} nested />
        </div>
        <div className="nav-section">
          <NavGroup items={[brainHub]} path={exact(brainHub)} onPick={onPick} />
          <NavGroup items={BRAIN} path={path} onPick={onPick} nested />
        </div>
      </MAppShell.Section>
      <MAppShell.Section px="sm" py="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <NavGroup items={[SETTINGS]} path={path} onPick={onPick} />
      </MAppShell.Section>
    </>
  );
}

function TabButton({ item, active, onPick }: { item: NavItem; active: boolean; onPick: () => void }) {
  const I = item.icon;
  return (
    <button type="button" className="tab-btn" data-href={item.path} data-active={active || undefined} aria-current={active ? 'page' : undefined} onClick={onPick}>
      <span className="tab-pill">
        <I size={22} stroke={active ? 2 : STROKE} />
      </span>
      <span>{item.label}</span>
    </button>
  );
}

function AddButton() {
  const timer = useRef<number | null>(null);
  const long = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className="add-btn"
      aria-label="Quick add. Hold for voice."
      onPointerDown={() => {
        long.current = false;
        clear();
        timer.current = window.setTimeout(() => {
          long.current = true;
          feel('tap');
          openCaptureVoice();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (long.current) {
          long.current = false;
          return;
        }
        openQuickCapture();
      }}
    >
      <IconPlus size={26} stroke={2.25} />
    </button>
  );
}

function BottomBar({ path, onTab }: { path: string; onTab: (item: NavItem) => void }) {
  const sec = sectionOf(path);
  const [a, b, c, d] = BOTTOM;
  return (
    <nav aria-label="Main" style={{ display: 'flex', alignItems: 'center', height: 'var(--app-bar-h)', padding: '0 4px' }}>
      <TabButton item={a} active={sec === a.path} onPick={() => onTab(a)} />
      <TabButton item={b} active={sec === b.path} onPick={() => onTab(b)} />
      <AddButton />
      <TabButton item={c} active={sec === c.path} onPick={() => onTab(c)} />
      <TabButton item={d} active={sec === d.path} onPick={() => onTab(d)} />
    </nav>
  );
}

/** The frame: header, desktop sidebar, phone bottom bar, global sheets, and the routed screen. */
export function AppShell(): ReactNode {
  const navigate = useNavigate();
  const loc = useLocation();
  const path = loc.pathname;
  const phone = usePhone();
  const kb = useKeyboardOpen();
  const places = usePlaces(path, loc.search);
  const navType = useNavigationType();

  useEffect(() => {
    bindNavigate(navigate);
    return () => bindNavigate(null);
  }, [navigate]);

  useEffect(() => startStatusPolling(), []);

  // Load a screen's chunk on intent (touch, hover, keyboard focus) so the tap paints at once.
  useEffect(() => {
    const on = (e: Event) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('a[href^="#/"], [data-href]') : null;
      if (!el) return;
      const to = el.dataset.href ?? el.getAttribute('href')?.slice(1);
      if (to) prefetchRoute(to.split('?')[0]);
    };
    const opts = { passive: true, capture: true } as const;
    document.addEventListener('pointerdown', on, opts);
    document.addEventListener('mouseover', on, opts);
    document.addEventListener('focusin', on, opts);
    return () => {
      document.removeEventListener('pointerdown', on, opts);
      document.removeEventListener('mouseover', on, opts);
      document.removeEventListener('focusin', on, opts);
    };
  }, []);

  // Text shared from another app while Mosaic is open.
  useEffect(() => {
    const onShare = () => {
      const text = takeShared();
      if (text) openQuickCapture(null, text);
    };
    window.addEventListener(SHARE_EVENT, onShare);
    return () => window.removeEventListener(SHARE_EVENT, onShare);
  }, []);

  // A new screen starts at the top (the window scrolls, so the old position would carry over). Same screen with a new
  // query (a filter, a tab) keeps its place; Back restores what the browser remembers.
  useEffect(() => {
    if (navType === 'POP') return;
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Keep document title in sync for screens that do not set their own.
  useEffect(() => {
    const t = screenOf(path);
    if (t && !document.title.startsWith(t)) document.title = `${t} · Mosaic`;
  }, [path]);

  const pick = (to: string) => {
    go(to);
  };

  const onTab = (item: NavItem) => {
    feel.tap();
    const sec = sectionOf(path);
    if (sec === item.path) {
      // Tapping the section you are in goes to its root.
      if (path !== item.path) go(item.path);
      return;
    }
    go(places.current[item.path] ?? item.path);
  };

  const footerHidden = !phone || kb;

  return (
    <MAppShell
      header={{ height: 'calc(3.5rem + var(--sat))' }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: 'calc(4rem + var(--sab))', collapsed: footerHidden }}
      padding={0}
    >
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>

      <MAppShell.Header className="app-header" withBorder>
        <Header phone={phone} path={path} />
      </MAppShell.Header>

      {/* Phones navigate with the bottom bar; the collapsed sidebar is never shown there, so keep it out of tab order. */}
      <MAppShell.Navbar className="app-navbar" withBorder inert={phone}>
        {!phone && <Sidebar path={path} onPick={pick} />}
      </MAppShell.Navbar>

      <MAppShell.Main className="app-main">
        <DemoBanner />
        <NetBanner />
        <RefreshLine />
        <PullToRefresh />
        <Box id="main" tabIndex={-1} style={{ outline: 'none' }}>
          <ErrorBoundary label={screenOf(path) ?? 'screen'} resetKey={path} onHome={() => void navigate('/chat')}>
            <Suspense fallback={<Box p="md"><Loading /></Box>}>
              <AppRoutes />
            </Suspense>
          </ErrorBoundary>
        </Box>
      </MAppShell.Main>

      <MAppShell.Footer className="app-footer" withBorder>
        <BottomBar path={path} onTab={onTab} />
      </MAppShell.Footer>

      <Notify />
      <Shortcuts />
      <SpotlightHost />
      <Boundary label="Quick add">
        <QuickAdd />
      </Boundary>
      <Boundary label="Keys">
        <KeysSheet />
      </Boundary>
      <Boundary label="Mode">
        <ModeSheet />
      </Boundary>
    </MAppShell>
  );
}

/** A 2px line under the header while a screen refreshes data it already shows. */
function RefreshLine() {
  const on = useRefreshing();
  return on ? <div className="refresh-line" role="progressbar" aria-label="Refreshing" /> : null;
}

const PULL_AT = 72;

/** Touch only: pull down at the top of a screen to reload what it shows. */
function PullToRefresh() {
  const [dy, setDy] = useState(0);
  const start = useRef<{ y: number; x: number } | null>(null);
  const dyRef = useRef(0);
  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const skip = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.mantine-Modal-root, .mantine-Drawer-root, .mantine-ScrollArea-viewport, textarea, [data-no-ptr], .tabs-scroll');
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 && !skip(e.target) ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null;
    };
    const move = (e: TouchEvent) => {
      const s0 = start.current;
      if (!s0) return;
      const d = e.touches[0].clientY - s0.y;
      if (window.scrollY > 0 || d <= 0 || Math.abs(e.touches[0].clientX - s0.x) > d) {
        if (dyRef.current) setDy((dyRef.current = 0));
        return;
      }
      const v = Math.min(110, d * 0.5);
      if (dyRef.current < PULL_AT && v >= PULL_AT) feel.tap();
      setDy((dyRef.current = v));
    };
    const up = () => {
      if (dyRef.current >= PULL_AT) {
        window.dispatchEvent(new Event(PULL_EVENT));
      }
      start.current = null;
      setDy((dyRef.current = 0));
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, []);
  if (dy <= 8) return null;
  const ready = dy >= PULL_AT;
  return (
    <div className="ptr" aria-hidden style={{ opacity: Math.min(1, dy / PULL_AT), transform: `translateY(${dy - 40}px)` }}>
      <IconArrowDown size={18} stroke={STROKE} style={{ transform: `rotate(${ready ? 180 : 0}deg)`, transition: 'transform 120ms ease' }} />
    </div>
  );
}
