import { Button, Group, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { IconArrowsExchange, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { Async, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden } from '../review/kit';
import { people, type LentRow } from './client';
import { Row } from './parts';
import { HelpedSection } from './HelpedSection';

/* ---------- Lent & Helped ---------- */

export function LentHelpedPane() {
  return (
    <>
      <LentSection />
      <HelpedSection />
    </>
  );
}

function LentSection() {
  const active = usePageActive();
  const [showAll, setShowAll] = useState(false);
  const l = useLoad(() => people.lent(showAll), active, [showAll], { key: `people.lent.${showAll ? 'all' : 'open'}` });
  const hidden = useHidden();
  const [busy, setBusy] = useState<string | null>(null);
  const back = async (r: LentRow) => {
    setBusy(r.id);
    const ok = await act(people.returnLent(r.id), 'Back home');
    setBusy(null);
    if (ok) void l.reload();
  };
  return (
    <Section
      title="Lent and borrowed"
      icon={IconArrowsExchange}
      hint="Things only. Money goes in Debts."
      right={
        <Button size="compact-sm" variant="subtle" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide returned' : 'Show returned'}
        </Button>
      }
    >
      <Stack gap="sm">
        <Async state={l} lines={2}>
          {(rows) => {
            const shown = rows.filter((r) => !hidden.has(r.id));
            if (shown.length === 0) return <Hint>Nothing out or borrowed.</Hint>;
            return (
              <Stack gap={0}>
                {shown.map((r) => (
                  <Row
                    key={r.id}
                    title={`${r.thing} · ${r.direction === 'lent' ? 'with' : 'from'} ${r.person}`}
                    sub={[
                      `${r.direction} ${f.day(r.since)}`,
                      r.back_by ? `back by ${f.day(r.back_by)}` : null,
                      r.returned_at ? `returned ${f.ago(r.returned_at)}` : null,
                      r.note || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <>
                        {!r.returned_at && (
                          <Button size="compact-sm" variant="light" loading={busy === r.id} onClick={() => void back(r)}>
                            Back
                          </Button>
                        )}
                        <IconBtn
                          icon={IconTrash}
                          label={`Delete ${r.thing}`}
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            deleteLater({
                              text: `Deleted ${r.thing}`,
                              hide: () => hidden.hide(r.id),
                              restore: () => hidden.show(r.id),
                              run: () => people.removeLent(r.id),
                              after: () => void l.reload(),
                            })
                          }
                        />
                      </>
                    }
                  />
                ))}
              </Stack>
            );
          }}
        </Async>
        <AddLent onAdded={() => void l.reload()} />
      </Stack>
    </Section>
  );
}

function AddLent({ onAdded }: { onAdded: () => void }) {
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [thing, setThing] = useState('');
  const [person, setPerson] = useState('');
  const [backBy, setBackBy] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!thing.trim() || !person.trim() || busy) return;
    setBusy(true);
    const r = await act(
      people.addLent({ thing: thing.trim(), person: person.trim(), direction, back_by: backBy || undefined }),
      direction === 'lent' ? 'Noted as lent' : 'Noted as borrowed',
    );
    setBusy(false);
    if (r) {
      setThing('');
      setPerson('');
      setBackBy('');
      onAdded();
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Stack gap="xs">
        <SegmentedControl
          size="xs"
          value={direction}
          onChange={(v) => setDirection(v as 'lent' | 'borrowed')}
          data={[
            { value: 'lent', label: 'I lent' },
            { value: 'borrowed', label: 'I borrowed' },
          ]}
        />
        <Group grow wrap="nowrap" gap="xs">
          <TextInput aria-label="Thing" placeholder="Thing" value={thing} maxLength={80} onChange={(e) => setThing(e.currentTarget.value)} />
          <TextInput
            aria-label={direction === 'lent' ? 'To whom' : 'From whom'}
            placeholder={direction === 'lent' ? 'To whom' : 'From whom'}
            value={person}
            maxLength={60}
            onChange={(e) => setPerson(e.currentTarget.value)}
          />
        </Group>
        <Group gap="xs" wrap="nowrap">
          <TextInput aria-label="Back by (optional)" type="date" value={backBy} onChange={(e) => setBackBy(e.currentTarget.value)} style={{ flex: 1, minWidth: 0 }} />
          <Button type="submit" variant="light" loading={busy} disabled={!thing.trim() || !person.trim()}>
            Add
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
