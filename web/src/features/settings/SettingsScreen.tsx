import { Alert, Box, Button, Divider, Group, Stack, Text, Textarea } from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconBell,
  IconChevronRight,
  IconBrandGoogle,
  IconCircleCheck,
  IconCircleX,
  IconHeartbeat,
  IconInfoCircle,
  IconKeyboard,
  IconLifebuoy,
  IconLogout,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DEMO, MOCK, type Check } from '../../api';
import { STROKE } from '../../app/icons';
import { API_BASE, lastEmail, signOut, TOKEN_MODE } from '../../auth';
import { BRAND } from '../../brand';
import { reducedMotion } from '../../feel';
import { ago, num } from '../../fmt';
import { openExternal } from '../../device';
import { go, replace } from '../../router';
import { hm } from '../../time';
import { refreshStatus, statusStore } from '../../status';
import { net, toast, useStore } from '../../store';
import { isSection, openKeys, ui, type GoogleResult, type SettingsSection } from '../../ui';
import { act, useLoad } from '../../ui/data';
import { v2 } from '../../v2';
import { ErrorState, IconBtn, Page, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { ScrollRow } from '../../ui/RouteTabs';
import { AppearanceSection, FeelSection, VoiceSection } from './FeelSections';
import { ModeList } from './ModeList';

type NavId = Exclude<SettingsSection, 'links'>;
const NAV: [NavId, string][] = [
  ['mode', 'Mode'],
  ['look', 'Appearance'],
  ['sound', 'Feel'],
  ['voice', 'Voice'],
  ['google', 'Account'],
  ['status', 'Checks'],
  ['app', 'About'],
];
const navId = (s: SettingsSection): NavId => (s === 'links' ? 'app' : s);

function scrollToSection(id: SettingsSection, focus = false) {
  const el = document.getElementById(`settings-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (focus) el.focus({ preventScroll: true });
}

/** Scroll target for `?section=` and the nav. Keeps the heading clear of the sticky header. */
function Spot({ id, children }: { id: SettingsSection | 'badday' | 'signout'; children: ReactNode }) {
  return (
    <Box id={`settings-${id}`} tabIndex={-1} data-section={id} style={{ scrollMarginTop: 72, outline: 'none' }}>
      {children}
    </Box>
  );
}

/** One label + value line in a section. */
function Row({ label, children, right }: { label: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
      <Box style={{ minWidth: 0 }}>
        <Text size="sm">{label}</Text>
        {children && (
          <Text size="xs" c="dimmed">
            {children}
          </Text>
        )}
      </Box>
      {right}
    </Group>
  );
}

// ---- Bad day ----

function BadDaySection() {
  const m = useLoad(() => v2.badDay(), true);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = text ?? (m.data?.items ?? []).join('\n');

  const save = async () => {
    const items = value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) {
      toast('Keep at least one small thing');
      return;
    }
    setBusy(true);
    const r = await act(v2.setBadDay(items), 'Saved');
    setBusy(false);
    if (r) {
      m.setData(r);
      setText(null);
    }
  };

  return (
    <Section title="Bad day menu" icon={IconLifebuoy}>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          The short menu shown on a bad day. One per line. Small enough to do lying down.
        </Text>
        {m.error && !m.data ? (
          <ErrorState error={m.error} onRetry={() => void m.reload()} />
        ) : (
          <Textarea aria-label="Bad day menu" autosize minRows={4} maxRows={10} value={value} disabled={m.loading} onChange={(e) => setText(e.currentTarget.value)} />
        )}
        <Group>
          <Button size="sm" loading={busy} disabled={text === null} onClick={() => void save()}>
            Save menu
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}

// ---- Account and Google ----

function connectionLine(online: boolean, reachable: boolean, waiting: number): string {
  if (online && reachable) return waiting > 0 ? `Connected, sending ${num(waiting)}` : 'Connected';
  return `Offline, ${num(waiting)} queued`;
}

function connectGoogle() {
  if (MOCK) {
    ui.set({ google: { ok: true, reason: null } });
    void refreshStatus();
    return;
  }
  if (TOKEN_MODE) {
    openExternal(`${API_BASE}/login?next=${encodeURIComponent('/api/google/connect')}`);
    return;
  }
  location.href = '/api/google/connect';
}

function GoogleResultNote({ result }: { result: GoogleResult }) {
  if (result.ok) {
    return (
      <Alert color="brand" variant="light" icon={<IconCircleCheck size={18} stroke={STROKE} />}>
        Google connected. Home will load your calendar.
      </Alert>
    );
  }
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} stroke={STROKE} />}>
      Google did not connect{result.reason ? `: ${result.reason}` : '.'} Try again below.
    </Alert>
  );
}

function AccountSection({ result }: { result: GoogleResult | null }) {
  const { online, reachable, queued, outbox } = useStore(net);
  const { data } = useStore(statusStore);
  const check = data?.checks.find((c) => c.id.toLowerCase().includes('google')) ?? null;
  const connected = check?.ok === true;
  const googleText = connected ? 'Connected. Mosaic reads your calendar and writes block tasks.' : (check?.message ?? 'Connection state unknown.');

  return (
    <Section title="Account" icon={IconBrandGoogle}>
      <Stack gap="md">
        {result && <GoogleResultNote result={result} />}
        <Row label="Signed in as">{lastEmail() ?? 'Owner'}</Row>
        <Row label="Server">{connectionLine(online, reachable, queued + outbox)}</Row>
        <Row
          label="Google Calendar"
          right={
            <Button size="compact-sm" variant={connected ? 'default' : 'filled'} onClick={connectGoogle}>
              {connected ? 'Reconnect' : 'Connect'}
            </Button>
          }
        >
          {googleText}
        </Row>
        <Text size="xs" c="dimmed">
          Passwords and codes: see password manager.
        </Text>
      </Stack>
    </Section>
  );
}

// ---- Checks ----

function LevelIcon({ level }: { level: Check['level'] }) {
  if (level === 'ok') return <IconCircleCheck size={18} stroke={STROKE} color="var(--mantine-color-brand-filled)" aria-label="OK" />;
  if (level === 'warn') return <IconAlertTriangle size={18} stroke={STROKE} color="var(--mantine-color-yellow-6)" aria-label="Warning" />;
  return <IconCircleX size={18} stroke={STROKE} color="var(--mantine-color-red-6)" aria-label="Error" />;
}

function StatusSection() {
  const { data, error, loading } = useStore(statusStore);
  useEffect(() => {
    if (!statusStore.get().data) void refreshStatus();
  }, []);
  const checks = data?.checks ?? [];
  return (
    <Section
      title="Checks"
      icon={IconHeartbeat}
      right={<IconBtn icon={IconRefresh} label="Run checks again" onClick={() => void refreshStatus()} loading={loading} />}
    >
      {error && !data ? (
        <ErrorState error={error} onRetry={() => void refreshStatus()} />
      ) : !data || !checks.length ? (
        <Text size="sm" c="dimmed">
          {loading ? 'Running checks.' : 'No checks reported yet. Refresh to run them.'}
        </Text>
      ) : (
        <Stack gap="sm">
          {checks.map((c) => (
            <Group key={c.id} wrap="nowrap" gap="sm" align="flex-start">
              <Box pt={2}>
                <LevelIcon level={c.level} />
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={600}>
                  {c.label}
                </Text>
                <Text size="xs" c="dimmed">
                  {c.message}
                </Text>
                {!c.ok && c.fix && (
                  <Text size="xs" mt={2}>
                    Fix: {c.fix}
                  </Text>
                )}
              </Box>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            Checked {ago(data.updatedAt)}
          </Text>
        </Stack>
      )}
    </Section>
  );
}

// ---- Notifications ----

/** One line of state and the way into the full notification screen. */
function NotificationsSection() {
  const s = useLoad(() => v2.pushStatus(), true, [], { key: 'push.status' });
  const d = s.data;
  const line = !d
    ? 'What Mosaic pushes, when, and what it held back.'
    : d.quiet
      ? `Holding (${d.reason ?? 'quiet'})${d.until ? ` until ${hm(d.until)}` : ''}. ${d.held} waiting.`
      : `On. ${d.upcoming.length ? `Next at ${d.upcoming[0]!.hhmm}.` : 'Nothing else today.'}${d.held ? ` ${d.held} waiting.` : ''}`;
  return (
    <Section title="Notifications" icon={IconBell}>
      <Row
        label="Pushes"
        right={
          <Button size="compact-sm" variant="default" rightSection={<IconChevronRight size={14} stroke={STROKE} />} onClick={() => go('/settings/notifications')}>
            Open
          </Button>
        }
      >
        {line}
      </Row>
    </Section>
  );
}

// ---- About ----

function AppSection() {
  const build = 'Web' + (DEMO ? ', demo' : MOCK ? ', mock data' : '');
  return (
    <Section title="About" icon={IconInfoCircle}>
      <Stack gap="md">
        <Row label="Version" right={<Text size="sm" c="dimmed" className="num">{__APP_VERSION__}</Text>} />
        <Row label="Built" right={<Text size="sm" c="dimmed">{ago(__BUILT_AT__)}</Text>} />
        <Row label="Build" right={<Text size="sm" c="dimmed">{build}</Text>} />
        <Divider />
        <Box id="settings-links" style={{ scrollMarginTop: 72 }}>
          <Row
            label="Keyboard shortcuts"
            right={
              <Button size="compact-sm" variant="default" leftSection={<IconKeyboard size={14} stroke={STROKE} />} onClick={openKeys}>
                Show
              </Button>
            }
          />
        </Box>
        <Text size="xs" c="dimmed">
          {BRAND.name}. {BRAND.tagline}
        </Text>
      </Stack>
    </Section>
  );
}

// ---- Sign out ----

function SignOutSection() {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    setAsk(false);
  };
  return (
    <>
      <Button variant="default" color="red" leftSection={<IconLogout size={16} stroke={STROKE} />} onClick={() => setAsk(true)}>
        Sign out
      </Button>
      <Sheet
        opened={ask}
        onClose={() => setAsk(false)}
        title="Sign out of Mosaic on this device?"
        size="sm"
        footer={
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setAsk(false)} disabled={busy}>
              Stay signed in
            </Button>
            <Button color="red" loading={busy} onClick={() => void go()}>
              Sign out
            </Button>
          </Group>
        }
      >
        <Text size="sm">You will need your email, password and a code to get back in.</Text>
      </Sheet>
    </>
  );
}

// ---- Page ----

export function SettingsScreen() {
  const { google } = useStore(ui);
  const loc = useLocation();
  const asked = new URLSearchParams(loc.search).get('section');
  const [here, setHere] = useState<NavId>(isSection(asked) ? navId(asked) : 'mode');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (google) void refreshStatus();
  }, [google]);

  // `?section=…` jumps once, then leaves the URL as plain /settings.
  useEffect(() => {
    if (!isSection(asked)) return;
    setHere(navId(asked));
    const first = window.setTimeout(() => {
      scrollToSection(asked, true);
      replace('/settings');
    }, 350);
    // Async sections (mode, checks) fill in later; jump again once. The URL change re-runs this effect without a section.
    window.setTimeout(() => scrollToSection(asked), 1000);
    return () => clearTimeout(first);
  }, [asked]);

  // Highlight the section in view.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = top?.target.getAttribute('data-section');
        if (id && isSection(id)) setHere(navId(id));
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    root.querySelectorAll('[data-section]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Leaving the page drops a stale Google result.
  useEffect(() => () => ui.set({ google: null }), []);

  const nav = (
    <ScrollRow active={here}>
      <Group gap={4} wrap="nowrap" component="nav" aria-label="Settings sections" w="max-content">
        {NAV.map(([id, label]) => (
          <Button
            key={id}
            size="compact-sm"
            variant={id === here ? 'light' : 'subtle'}
            color={id === here ? undefined : 'gray'}
            aria-current={id === here ? 'true' : undefined}
            data-active={id === here || undefined}
            className="shrink0"
            onClick={() => {
              setHere(id);
              scrollToSection(id, true);
            }}
          >
            {label}
          </Button>
        ))}
      </Group>
    </ScrollRow>
  );

  return (
    <Page title="Settings" icon={IconSettings} toolbar={nav}>
      <Stack gap="md" ref={bodyRef}>
        <Spot id="mode">
          <Section title="Mode" icon={IconAdjustmentsHorizontal}>
            <ModeList />
          </Section>
        </Spot>
        <Spot id="badday">
          <BadDaySection />
        </Spot>
        <Spot id="look">
          <AppearanceSection />
        </Spot>
        <Spot id="sound">
          <FeelSection />
        </Spot>
        <Spot id="voice">
          <VoiceSection />
        </Spot>
        <NotificationsSection />
        <Spot id="google">
          <AccountSection result={google} />
        </Spot>
        <Spot id="status">
          <StatusSection />
        </Spot>
        <Spot id="app">
          <AppSection />
        </Spot>
        {!MOCK && (
          <Spot id="signout">
            <SignOutSection />
          </Spot>
        )}
      </Stack>
    </Page>
  );
}
