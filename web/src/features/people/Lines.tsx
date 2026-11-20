// "Around you": short lines for Home. Promises, occasions this week, people due, waiting checks, due capsules.
// Hides itself when there is nothing to say.
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad } from '../../hooks';
import { life } from '../../life';
import { Link, Section } from '../../ui/Page';
import { whenText } from '../review/kit';

export function PeopleLines({ active }: { active: boolean }) {
  const pr = useLoad(() => life.promisesSoon(), active, [], { key: 'people.promises.soon' });
  const pe = useLoad(() => life.peopleDue(), active, [], { key: 'people.due' });
  const oc = useLoad(() => life.occasionsSoon(), active, [], { key: 'people.occasions.soon' });
  const wa = useLoad(() => life.waitingDue(), active, [], { key: 'people.waiting.due' });
  const ca = useLoad(() => life.capsulesDue(), active, [], { key: 'people.capsules.due' });
  const [opened, setOpened] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const once = async (key: string, run: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };

  const promises = (pr.data ?? []).slice(0, 3);
  const people = (pe.data ?? []).slice(0, 3);
  const occasions = (oc.data ?? []).filter((o) => o.days_until <= 7).slice(0, 3);
  // The server sends task_id for waiting rows; the shared type says id.
  const waiting = (wa.data ?? []).slice(0, 3).map((w) => ({ ...w, key: (w as { task_id?: string }).task_id ?? w.id }));
  const capsules = ca.data ?? [];
  if (!promises.length && !people.length && !occasions.length && !waiting.length && !capsules.length && !opened) return null;

  return (
    <Section title="Around you" icon={IconUsers} right={<Link className="tap" to="/life/people">People</Link>}>
      <Stack gap={6}>
        {promises.map((p) => (
          <Row key={'p' + p.id} text={`Promised ${p.who}: ${p.what}`} sub={p.days_until != null ? whenText(p.days_until) : undefined}>
            <Button
              size="compact-sm"
              variant="subtle"
              disabled={busy !== null}
              onClick={() => void once('kept' + p.id, () => act(life.keepPromise(p.id), 'Kept').then((r) => void (r && pr.reload())))}
            >
              Kept
            </Button>
          </Row>
        ))}
        {occasions.map((o) => (
          <Row key={'o' + o.id} text={`${o.name}${o.years ? ` (${o.years})` : ''}`} sub={whenText(o.days_until)} />
        ))}
        {people.map((p) => (
          <Row key={'h' + p.id} text={p.name} sub={p.days_since != null ? `last ${f.plural(p.days_since, 'day')} ago` : undefined}>
            <Button
              size="compact-sm"
              variant="subtle"
              disabled={busy !== null}
              onClick={() => void once('talk' + p.id, () => act(life.touch(p.id), `Noted: ${p.name}`).then((r) => void (r && pe.reload())))}
            >
              Talked
            </Button>
          </Row>
        ))}
        {waiting.map((w) => (
          <Row key={'w' + w.key} text={`Check: ${w.title}`} sub={w.waiting_for ?? undefined} />
        ))}
        {capsules.map((c) => (
          <Row key={'c' + c.id} text={`A note from past you: ${c.title || 'untitled'}`}>
            <Button
              size="compact-sm"
              variant="subtle"
              disabled={busy !== null}
              onClick={() =>
                void once('cap' + c.id, () =>
                  act(life.openCapsule(c.id)).then((r) => {
                    if (r) {
                      setOpened({ title: r.title, body: r.body });
                      void ca.reload();
                    }
                  }),
                )
              }
            >
              Open
            </Button>
          </Row>
        ))}
        {opened && <OpenedNote title={opened.title} body={opened.body} onClose={() => setOpened(null)} />}
      </Stack>
    </Section>
  );
}

function Row({ text, sub, children }: { text: string; sub?: string; children?: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" style={{ minWidth: 0, flex: 1 }}>
        {text}
        {sub ? (
          <Text span c="dimmed" size="sm">
            {' '}
            · {sub}
          </Text>
        ) : null}
      </Text>
      {children}
    </Group>
  );
}

export function OpenedNote({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap={6}>
        <Text fw={600}>{title || 'A note from past you'}</Text>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {body}
        </Text>
        <Group justify="flex-end">
          <Button size="compact-sm" variant="subtle" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
