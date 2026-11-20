// Notifications: what Mosaic will push next, what it held back and why, what it sent, and the switches.
// Everything here is also in chat (push_status, push_prefs, push_at, push_held, push_log, push_test).
import { ActionIcon, Badge, Box, Button, Group, NumberInput, SegmentedControl, Select, Skeleton, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import '@mantine/dates/styles.css';
import { IconBell, IconBellOff, IconBellRinging, IconClockHour4, IconHistory, IconMoonStars, IconPlayerPause, IconSend, IconTrash, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { STROKE } from '../../app/icons';
import { ago, plural } from '../../fmt';
import { hm } from '../../time';
import { toast } from '../../store';
import { act, useLoad } from '../../ui/data';
import { ErrorState, Page, Section } from '../../ui/Page';
import { PUSH_CATS, v2, type PushCat, type PushCentre, type PushLogRow, type PushPrefs, type PushStatus } from '../../v2';

/** Why a push waited, in his words. */
const REASON: Record<string, string> = {
  rescue: 'Rescue is on',
  mode: 'Zero or Family mode',
  sleep: 'Sleep',
  saturday: 'Saturday rest',
  burst: 'Too many this hour',
  retry: 'Send failed, retrying',
};
const reasonText = (r: string | null | undefined) => (r ? (REASON[r] ?? r) : '');

const STATUS: Record<PushStatus, { label: string; color: string }> = {
  sent: { label: 'Sent', color: 'teal' },
  held: { label: 'Held', color: 'yellow' },
  muted: { label: 'Off', color: 'gray' },
  deduped: { label: 'Repeat', color: 'gray' },
  failed: { label: 'Failed', color: 'red' },
};
const KIND: Record<string, string> = { block: 'Block', task: 'Task', scheduled: 'Reminder' };

function StatusCard({ s, onFlush }: { s: PushCentre; onFlush: () => void }) {
  const Icon = s.quiet ? (s.reason === 'sleep' ? IconMoonStars : IconPlayerPause) : IconBellRinging;
  const head = s.quiet ? `Holding: ${reasonText(s.reason)}` : 'On. Pushes go out now.';
  const sub = s.quiet
    ? s.until
      ? `Until ${hm(s.until)}. Urgent ones still ring.`
      : 'Until the mode changes. Urgent ones still ring.'
    : `Sleep ${s.sleep.start}–${s.sleep.wake} holds them.`;
  const d = s.last24h;
  return (
    <Section>
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Icon size={22} stroke={STROKE} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} role="status">
              {head}
            </Text>
            <Text size="sm" c="dimmed">
              {sub}
            </Text>
          </Box>
        </Group>
        <Text size="sm" c="dimmed" className="num">
          Last 24 h: {d.sent} sent{d.held ? `, ${d.held} held` : ''}
          {d.muted ? `, ${d.muted} off` : ''}
          {d.deduped ? `, ${d.deduped} repeats skipped` : ''}
          {d.failed ? `, ${d.failed} failed` : ''}
          {s.last_sent ? `. Last: “${s.last_sent.title}” ${ago(s.last_sent.at)}.` : '.'}
        </Text>
        {s.held > 0 && (
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{plural(s.held, 'push')} waiting.</Text>
            <Button size="compact-sm" variant="light" leftSection={<IconSend size={14} stroke={STROKE} />} onClick={onFlush}>
              Send now
            </Button>
          </Group>
        )}
      </Stack>
    </Section>
  );
}

function Upcoming({ s, onCancel, onAdded }: { s: PushCentre; onCancel: (id: number) => void; onAdded: () => void }) {
  const [at, setAt] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!/^\d{2}:\d{2}$/.test(at) || !text.trim()) return;
    setBusy(true);
    const r = await act(v2.schedulePush({ at, title: 'Reminder', message: text.trim() }), `Push at ${at}`);
    setBusy(false);
    if (r) {
      setText('');
      setAt('');
      onAdded();
    }
  };
  return (
    <Section title="Next up" icon={IconClockHour4} hint="Today, in order. Blocks get a heads-up before they start.">
      <Stack gap="xs">
        {s.upcoming.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing else today.
          </Text>
        )}
        <Stack component="ul" gap={6} p={0} m={0} aria-label="Upcoming pushes">
          {s.upcoming.map((u, i) => (
            <Group component="li" key={`${u.kind}-${u.id ?? u.task_id ?? i}-${u.at}`} gap="sm" wrap="nowrap" style={{ listStyle: 'none' }}>
              <Text size="sm" fw={600} className="num" w={44} style={{ flexShrink: 0 }}>
                {u.hhmm}
              </Text>
              <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }}>
                {KIND[u.kind] ?? u.kind}
              </Badge>
              <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {u.title}
              </Text>
              {u.kind === 'scheduled' && u.id != null && (
                <Tooltip label="Cancel">
                  <ActionIcon variant="subtle" color="gray" aria-label={`Cancel reminder at ${u.hhmm}`} onClick={() => onCancel(u.id!)}>
                    <IconX size={16} stroke={STROKE} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
        <Group gap="xs" align="flex-end" wrap="nowrap" mt={4}>
          <TimeInput label="Remind me at" value={at} onChange={(e) => setAt(e.currentTarget.value)} w={110} style={{ flexShrink: 0 }} />
          <TextInput
            label="About"
            placeholder="Buy bread"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            style={{ flex: 1, minWidth: 0 }}
            maxLength={200}
          />
          <Button onClick={add} loading={busy} disabled={!/^\d{2}:\d{2}$/.test(at) || !text.trim()}>
            Add
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}

function Switches({ p, onChange }: { p: PushPrefs; onChange: (patch: Partial<PushPrefs>) => void }) {
  return (
    <Section title="What to send" icon={IconBell} hint="Off means it is never sent. Urgent ones (alarms) always ring.">
      <Stack gap="sm">
        {PUSH_CATS.map((c: PushCat) => (
          <Switch
            key={c}
            label={p.labels[c] ?? c}
            checked={p.cats[c]}
            onChange={(e) => onChange({ cats: { ...p.cats, [c]: e.currentTarget.checked } })}
          />
        ))}
      </Stack>
    </Section>
  );
}

function Timing({ p, onChange }: { p: PushPrefs; onChange: (patch: Partial<PushPrefs>) => void }) {
  const seg = (vals: number[]) => vals.map((v) => ({ value: String(v), label: v === 0 ? 'At start' : `${v} min` }));
  return (
    <Section title="Timing" icon={IconClockHour4}>
      <Stack gap="md">
        <Box>
          <Text size="sm" mb={4} id="lead-label">
            Block heads-up
          </Text>
          <SegmentedControl
            aria-labelledby="lead-label"
            fullWidth
            data={seg([0, 2, 5, 10])}
            value={String([0, 2, 5, 10].includes(p.block_lead_min) ? p.block_lead_min : 2)}
            onChange={(v) => onChange({ block_lead_min: Number(v) })}
          />
        </Box>
        <Box>
          <Text size="sm" mb={4} id="snooze-label">
            Snooze waits
          </Text>
          <SegmentedControl
            aria-labelledby="snooze-label"
            fullWidth
            data={seg([5, 10, 15, 30])}
            value={String([5, 10, 15, 30].includes(p.snooze_min) ? p.snooze_min : 10)}
            onChange={(v) => onChange({ snooze_min: Number(v) })}
          />
        </Box>
        <NumberInput
          label="Most pushes in one hour"
          description="Over this, the rest wait and go out together. Urgent ones are not counted."
          min={1}
          max={30}
          value={p.hourly_cap}
          onChange={(v) => typeof v === 'number' && v >= 1 && v <= 30 && onChange({ hourly_cap: v })}
          w={220}
        />
      </Stack>
    </Section>
  );
}

function Held({ onChanged }: { onChanged: () => void }) {
  const h = useLoad(() => v2.heldPushes(), true, [], { key: 'push.held' });
  const items = h.data?.items ?? [];
  if (!items.length) return null;
  const drop = async (id: number) => {
    if (await act(v2.dropHeld(id), 'Dropped')) {
      void h.reload();
      onChanged();
    }
  };
  return (
    <Section title="Waiting" icon={IconPlayerPause} hint="They go out on their own when the quiet time ends.">
      <Stack component="ul" gap={6} p={0} m={0} aria-label="Held pushes">
        {items.map((x) => (
          <Group component="li" key={x.id} gap="sm" wrap="nowrap" style={{ listStyle: 'none' }}>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" truncate>
                {x.title}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {reasonText(x.reason)} · held {ago(x.held_at)}
              </Text>
            </Box>
            <Tooltip label="Drop">
              <ActionIcon variant="subtle" color="gray" aria-label={`Drop ${x.title}`} onClick={() => drop(x.id)}>
                <IconTrash size={16} stroke={STROKE} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}
      </Stack>
    </Section>
  );
}

function LogRow({ r }: { r: PushLogRow }) {
  const st = STATUS[r.status] ?? { label: r.status, color: 'gray' };
  const why = r.status === 'sent' ? (r.reason === 'test' ? 'test' : '') : reasonText(r.reason);
  return (
    <Group component="li" gap="sm" wrap="nowrap" align="flex-start" style={{ listStyle: 'none' }}>
      <Text size="xs" c="dimmed" className="num" w={44} pt={2} style={{ flexShrink: 0 }}>
        {hm(r.at)}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" truncate>
          {r.title}
        </Text>
        {(r.message || why) && (
          <Text size="xs" c="dimmed" truncate>
            {[why, r.message].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Box>
      <Badge variant="light" color={st.color} size="sm" style={{ flexShrink: 0 }}>
        {st.label}
      </Badge>
    </Group>
  );
}

function History({ p, tick }: { p: PushPrefs | null; tick: number }) {
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const l = useLoad(() => v2.pushLog(limit, (cat ?? undefined) as PushCat | undefined), true, [cat, limit, tick]);
  const items = l.data?.items ?? [];
  return (
    <Section
      title="History"
      icon={IconHistory}
      right={
        <Select
          aria-label="Filter by kind"
          size="xs"
          w={160}
          clearable
          placeholder="All kinds"
          value={cat}
          onChange={setCat}
          data={PUSH_CATS.map((c) => ({ value: c, label: p?.labels[c] ?? c }))}
        />
      }
    >
      {l.error && !l.data ? (
        <ErrorState error={l.error} onRetry={l.reload} />
      ) : l.loading ? (
        <Stack gap={8}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={32} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing sent yet.
        </Text>
      ) : (
        <Stack gap="xs">
          <Stack component="ul" gap={8} p={0} m={0} aria-label="Push history">
            {items.map((r) => (
              <LogRow key={r.id} r={r} />
            ))}
          </Stack>
          {items.length >= limit && limit < 500 && (
            <Button variant="subtle" size="compact-sm" onClick={() => setLimit((n) => Math.min(500, n + 50))}>
              Show more
            </Button>
          )}
        </Stack>
      )}
    </Section>
  );
}

export function NotificationsScreen() {
  const st = useLoad(() => v2.pushStatus(), true, [], { key: 'push.status' });
  const pr = useLoad(() => v2.pushPrefs(), true, [], { key: 'push.prefs' });
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState(false);
  const refresh = () => {
    void st.reload();
    setTick((n) => n + 1);
  };

  const change = async (patch: Partial<PushPrefs>) => {
    const prev = pr.data;
    if (!prev) return;
    pr.setData({ ...prev, ...patch });
    const { labels: _labels, ...body } = patch;
    const r = await act(v2.setPushPrefs(body));
    if (r) pr.setData(r);
    else pr.setData(prev);
  };
  const test = async () => {
    setTesting(true);
    const r = await act(v2.testPush());
    setTesting(false);
    if (r) {
      toast(r.status === 'sent' ? 'Test sent. Check your phone.' : `Test ${r.status}: ${reasonText(r.reason)}`);
      refresh();
    }
  };
  const flush = async () => {
    const r = await act(v2.flushHeld());
    if (r) {
      toast(r.sent ? `${plural(r.sent, 'push')} sent` : 'Nothing to send');
      refresh();
    }
  };
  const cancel = async (id: number) => {
    if (await act(v2.cancelScheduled(id), 'Reminder cancelled')) refresh();
  };

  return (
    <Page
      title="Notifications"
      icon={IconBell}
      back="/settings"
      actions={
        <Button variant="default" leftSection={<IconBellRinging size={16} stroke={STROKE} />} onClick={test} loading={testing}>
          Test
        </Button>
      }
    >
      {st.error && !st.data ? (
        <ErrorState error={st.error} onRetry={st.reload} />
      ) : !st.data ? (
        <Skeleton h={120} radius="md" />
      ) : (
        <>
          <StatusCard s={st.data} onFlush={flush} />
          <Held key={`held-${tick}`} onChanged={refresh} />
          <Upcoming s={st.data} onCancel={cancel} onAdded={refresh} />
        </>
      )}
      {pr.error && !pr.data ? (
        <ErrorState error={pr.error} onRetry={pr.reload} />
      ) : pr.data ? (
        <>
          <Switches p={pr.data} onChange={change} />
          <Timing p={pr.data} onChange={change} />
        </>
      ) : (
        <Skeleton h={240} radius="md" />
      )}
      <History p={pr.data} tick={tick} />
      <Text size="xs" c="dimmed" ta="center">
        <IconBellOff size={12} stroke={STROKE} aria-hidden="true" style={{ verticalAlign: -1 }} /> To stop everything for a while, use Rescue or Zero mode.
      </Text>
    </Page>
  );
}
