import { Button, Chip, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconMailbox, IconPencil, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { toast } from '../../store';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden } from '../review/kit';
import { people, type CapsuleView } from './client';
import { OpenedNote } from './Lines';
import { Row } from './parts';

/* ---------- Capsules ---------- */

const CAPSULE_SPANS: { days: number; label: string }[] = [
  { days: 7, label: '1 week' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
];

export function CapsulesPane() {
  const active = usePageActive();
  const due = useLoad(() => people.capsulesDue(), active, [], { key: 'people.capsules.due' });
  const all = useLoad(() => people.capsules(), active, [], { key: 'people.capsules.all' });
  const hidden = useHidden();
  const [opened, setOpened] = useState<CapsuleView | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => {
    void due.reload();
    void all.reload();
  };
  const open = async (c: CapsuleView) => {
    setBusy(c.id);
    const r = await act(people.openCapsule(c.id));
    setBusy(null);
    if (r) {
      setOpened(r);
      reload();
    }
  };
  const remove = (c: CapsuleView) =>
    deleteLater({
      text: 'Capsule deleted',
      hide: () => hidden.hide(c.id),
      restore: () => hidden.show(c.id),
      run: () => people.removeCapsule(c.id),
      after: reload,
    });
  const dueRows = (due.data ?? []).filter((c) => !hidden.has(c.id));
  const rows = (all.data ?? []).filter((c) => !hidden.has(c.id));
  const sealedCount = rows.filter((c) => c.sealed).length;

  return (
    <>
      {(dueRows.length > 0 || opened) && (
        <Section title="Ready to open" icon={IconMailbox}>
          <Stack gap="xs">
            {dueRows.map((c) => (
              <Row
                key={c.id}
                title={`A note from past you: ${c.title || 'untitled'}`}
                sub={`written ${f.day(c.written_day)}`}
                right={
                  <Button size="compact-sm" variant="light" loading={busy === c.id} onClick={() => void open(c)}>
                    Open
                  </Button>
                }
              />
            ))}
            {opened && <OpenedNote title={opened.title} body={opened.body ?? ''} onClose={() => setOpened(null)} />}
          </Stack>
        </Section>
      )}
      <CapsuleWriter waiting={sealedCount} onSealed={reload} />
      <Section title="Capsules" icon={IconMailbox}>
        {all.data === null ? (
          <Async state={all} lines={3}>
            {() => null}
          </Async>
        ) : rows.length === 0 ? (
          <Empty title="No capsules yet." />
        ) : (
          <Stack gap={0}>
            {rows.map((c) => (
              <Stack key={c.id} gap={4}>
                <Row
                  title={c.title || 'Untitled'}
                  onClick={c.sealed ? undefined : () => setExpanded(expanded === c.id ? null : c.id)}
                  sub={
                    c.sealed
                      ? `sealed · opens ${f.day(c.open_on)} · written ${f.day(c.written_day)}`
                      : `opened ${c.opened_at ? f.ago(c.opened_at) : f.day(c.open_on)} · written ${f.day(c.written_day)}`
                  }
                  right={<IconBtn icon={IconTrash} label="Delete capsule" variant="subtle" color="gray" onClick={() => remove(c)} />}
                />
                {expanded === c.id && c.body && (
                  <Text size="sm" pb="xs" style={{ whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </Text>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Section>
    </>
  );
}

function CapsuleWriter({ waiting, onSealed }: { waiting: number; onSealed: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const seal = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const n = Number(days);
    const r = await act(people.writeCapsule({ body: body.trim(), title: title.trim() || undefined, in_days: n }));
    setBusy(false);
    if (r) {
      toast(n === 365 ? 'Opens in 1 year' : `Opens in ${f.plural(n, 'day')}`);
      setTitle('');
      setBody('');
      onSealed();
    }
  };
  return (
    <Section title="Write to future you" icon={IconPencil}>
      <Stack gap="xs">
        <TextInput aria-label="Title" placeholder="Title (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Textarea aria-label="Note" placeholder="What do you want to tell yourself?" autosize minRows={3} maxRows={10} maxLength={4000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
        <Chip.Group value={days} onChange={(v) => setDays(v as string)}>
          <Group gap={6}>
            {CAPSULE_SPANS.map((s) => (
              <Chip key={s.days} value={String(s.days)} size="sm">
                {s.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Group justify="space-between" wrap="nowrap" align="center">
          <Hint>
            {waiting > 0 ? `${f.plural(waiting, 'note')} waiting to open. ` : ''}It shows on Home on the day it opens.
          </Hint>
          <Button variant="light" onClick={() => void seal()} loading={busy} disabled={!body.trim()}>
            Seal
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}
