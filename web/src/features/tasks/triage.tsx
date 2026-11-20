// Inbox helpers: merge offer, "fits before" card, sort-five triage, compost, estimate hints and readout.
import { Anchor, Button, Collapse, Divider, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { emit, toast } from '../../store';
import { feel } from '../../sound';
import { act, useLoad } from '../../ui/data';
import { ErrorState, Loading, Section } from '../../ui/Page';
import { v2, type EstimateHint, type Similar, type TriageAction, type V2Project, type V2Task } from '../../v2';

/**
 * After a quick add: if the server found a similar open task, offer a merge for 7 s.
 * Returns true when the offer toast was shown (the caller skips its own "Added" toast).
 */
export function offerMerge(added: V2Task & { similar?: Similar[] }, after: () => void = () => {}): boolean {
  const s = added.similar?.[0];
  if (!s) return false;
  toast(`Looks like: ${s.title}`, {
    timeout: 7000,
    action: {
      label: 'Merge',
      run: () =>
        void act(v2.mergeTask(added.id, s.id)).then((r) => {
          if (!r) return;
          toast('Merged into the older task');
          emit('tasks');
          after();
        }),
    },
  });
  return true;
}

/** Up to three open tasks that fit before the next fixed anchor (meal, sleep). */
export function FitsCard({ active, version = 0 }: { active: boolean; version?: number }) {
  const r = useLoad(() => v2.fits(), active, [version], { key: 'tasks-fits' });
  const d = r.data;
  if (!d || !d.tasks.length || !d.anchor || !d.gap_min) return null;
  return (
    <Section title={`Fits before ${d.anchor.name}`}>
      <Text size="sm" c="dimmed" mb="xs">
        <span className="num">{f.minutes(d.gap_min)}</span> until <span className="num">{d.anchor.hhmm}</span>. Any one of these, or none.
      </Text>
      <Stack gap={4}>
        {d.tasks.slice(0, 3).map((t) => (
          <Group key={t.id} justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" lineClamp={1}>
              {t.title}
            </Text>
            {t.est_minutes ? (
              <Text size="xs" c="dimmed" className="num" style={{ flexShrink: 0 }}>
                {f.mins(t.est_minutes)}
              </Text>
            ) : null}
          </Group>
        ))}
      </Stack>
    </Section>
  );
}

const TRIAGE_BTNS: { id: TriageAction; label: string }[] = [
  { id: 'keep', label: 'Keep' },
  { id: 'someday', label: 'Someday' },
  { id: 'trash', label: 'Trash' },
];

/**
 * Sort five from the Inbox: keep, park, trash, or promote into a project (one move a day,
 * unless urgent). Closed it is a one-line link; open it is one Section.
 */
export function TriagePanel({
  active,
  version = 0,
  projects,
  onChanged,
  startOpen = false,
}: {
  active: boolean;
  version?: number;
  projects: V2Project[];
  onChanged: () => void;
  startOpen?: boolean;
}) {
  const r = useLoad(() => v2.triage(), active, [version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(startOpen);
  const d = r.data;
  if (!d || d.inbox_total === 0) return null;
  const decide = async (t: V2Task, action: TriageAction, project?: string, urgent = false) => {
    setBusy(t.id);
    try {
      await v2.triageDecide(t.id, action, { project, urgent });
      feel('tap');
      void r.reload();
      emit('tasks');
      onChanged();
    } catch (e) {
      const err = e as { status?: number; code?: string; message?: string };
      if (err.status === 409 || err.code === 'conflict') {
        toast('One move into a project a day. Urgent?', {
          timeout: 7000,
          action: { label: 'Yes, urgent', run: () => void decide(t, action, project, true) },
        });
      } else toast(err.message ?? 'Could not save');
    } finally {
      setBusy(null);
    }
  };
  const targets = projects.filter((p) => p.name !== 'Inbox').slice(0, 4);
  if (!open) {
    return (
      <Anchor component="button" type="button" size="sm" className="tap" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
        Sort 5 from the Inbox (<span className="num">{f.num(d.inbox_total)}</span>)
      </Anchor>
    );
  }
  return (
    <Section
      title="Sort five"
      right={
        <Button variant="subtle" size="compact-sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      }
    >
      <Text size="sm" c="dimmed" mb="sm">
        {d.promoted_today ? `Promoted today: ${d.promoted_today.title}. More go to Keep or Someday.` : 'One item a day can move into a project.'}
      </Text>
      <Stack gap="sm">
        {d.items.map((t, i) => (
          <Stack key={t.id} gap={6}>
            {i > 0 && <Divider />}
            <Text size="sm" fw={600}>
              {t.title}
            </Text>
            <Group gap={6} role="group" aria-label={`Sort: ${t.title}`}>
              {TRIAGE_BTNS.map((b) => (
                <Button key={b.id} size="compact-sm" variant="default" disabled={busy === t.id} onClick={() => void decide(t, b.id)}>
                  {b.label}
                </Button>
              ))}
              {targets.map((p) => (
                <Button key={p.id} size="compact-sm" variant="light" disabled={busy === t.id} onClick={() => void decide(t, 'project', p.name)}>
                  To {p.name}
                </Button>
              ))}
            </Group>
          </Stack>
        ))}
      </Stack>
    </Section>
  );
}

/** Inbox items the nightly compost moved out. Each can come back. */
export function CompostLink({
  active,
  version = 0,
  onChanged,
  startOpen = false,
}: {
  active: boolean;
  version?: number;
  onChanged: () => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const r = useLoad(() => v2.compost(), active && open, [open, version]);
  const head = useLoad(() => v2.compost(), active, [version]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const n = head.data?.items.length ?? 0;
  if (!n && !open) return null;
  const restore = async (t: V2Task) => {
    if (restoring) return;
    setRestoring(t.id);
    let x;
    try {
      x = await act(v2.restoreCompost(t.id));
    } finally {
      setRestoring(null);
    }
    if (x) {
      toast('Back in the Inbox');
      void r.reload();
      void head.reload();
      emit('tasks');
      onChanged();
    }
  };
  const Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <Stack gap="xs">
      <UnstyledButton aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ alignSelf: 'flex-start' }}>
        <Group gap={4}>
          <Chevron size={16} stroke={STROKE} />
          <Text size="sm" c="dimmed">
            Composted (<span className="num">{f.num(n)}</span>)
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        {open && !r.data && !r.error && <Loading label="Loading compost" lines={2} />}
        {open && r.error && !r.data && <ErrorState error={r.error} onRetry={() => void r.reload()} />}
        {open && r.data && r.data.items.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing composted.
          </Text>
        )}
        <Stack gap={4}>
          {(r.data?.items ?? []).map((t) => (
            <Group key={t.id} justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" lineClamp={2} style={{ flex: 1, minWidth: 0 }}>
                {t.title}
              </Text>
              <Button size="compact-sm" variant="default" disabled={restoring === t.id} onClick={() => void restore(t)}>
                Restore
              </Button>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}

/** Under the minutes field: "Similar tasks took ×1.4 the estimate. About 35 min. Use 35 min". */
export function EstimateHintLine({ minutes, tags, onUse }: { minutes: string; tags: string[]; onUse: (n: number) => void }) {
  const [hint, setHint] = useState<EstimateHint>(null);
  const key = tags.join(',');
  useEffect(() => {
    const n = Math.round(Number(minutes));
    if (!minutes.trim() || !Number.isFinite(n) || n <= 0) {
      setHint(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      v2.estimateHint(n, tags)
        .then((h) => live && setHint(h))
        .catch(() => live && setHint(null));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, key]);
  if (!hint || hint.suggest === hint.minutes) return null;
  return (
    <Text size="xs" c="dimmed">
      Similar tasks ({hint.from}) took <span className="num">×{f.fixed(hint.ratio, 1)}</span> the estimate. About{' '}
      <span className="num">{f.minutes(hint.suggest)}</span>.{' '}
      <Anchor component="button" type="button" size="xs" onClick={() => onUse(hint.suggest)}>
        Use {f.minutes(hint.suggest)}
      </Anchor>
    </Text>
  );
}

/** Done view: how long timed tasks really took against their estimate. */
export function EstimatesReadout({ active }: { active: boolean }) {
  const e = useLoad(() => v2.estimates(), active, [], { key: 'tasks-estimates' });
  const d = e.data;
  if (!d) return null;
  if (!d.overall.n)
    return (
      <Text size="sm" c="dimmed">
        {d.note}
      </Text>
    );
  const rows = [
    { label: 'All timed tasks', value: d.overall.ratio == null ? f.DASH : `×${f.fixed(d.overall.ratio, 2)}`, sub: f.plural(d.overall.n, 'task') },
    ...d.by_tag.map((t) => ({ label: `#${t.tag}`, value: `×${f.fixed(t.ratio, 2)}`, sub: f.plural(t.n, 'task') })),
  ];
  return (
    <Section title="Estimates vs real">
      <Stack gap={6}>
        {rows.map((r) => (
          <Group key={r.label} justify="space-between" wrap="nowrap">
            <Text size="sm">{r.label}</Text>
            <Group gap="sm" wrap="nowrap">
              <Text size="xs" c="dimmed" className="num">
                {r.sub}
              </Text>
              <Text size="sm" fw={600} className="num">
                {r.value}
              </Text>
            </Group>
          </Group>
        ))}
      </Stack>
      <Text size="xs" c="dimmed" mt="sm">
        {d.note}
      </Text>
    </Section>
  );
}
