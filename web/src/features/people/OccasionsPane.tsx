import { Button, Group, Select, Stack, TextInput } from '@mantine/core';
import { IconCake, IconCalendar, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden, whenText } from '../review/kit';
import { OCCASION_KINDS, people } from './client';
import { md, Row } from './parts';

/* ---------- Occasions ---------- */

export function OccasionsPane() {
  const active = usePageActive();
  const soon = useLoad(() => people.occasionsSoon(60), active, [], { key: 'people.occasions.60' });
  const all = useLoad(() => people.occasions(), active, [], { key: 'people.occasions.all' });
  const hidden = useHidden();
  const reload = () => {
    void soon.reload();
    void all.reload();
  };
  return (
    <>
      <Async state={soon} lines={3}>
        {(rows) => {
          const shown = rows.filter((o) => !(o.source === 'occasion' && hidden.has(o.id)));
          return (
            <Section title="Next 60 days" icon={IconCake}>
              {shown.length === 0 ? (
                <Empty title="Nothing in the next 60 days." />
              ) : (
                <Stack gap={0}>
                  {shown.map((o) => (
                    <Row
                      key={`${o.source}-${o.id}`}
                      title={`${o.name}${o.years ? ` (${o.years})` : ''}`}
                      sub={`${o.kind} · ${o.approx ? 'about ' : ''}${f.day(o.date)} · ${whenText(o.days_until)}`}
                    />
                  ))}
                </Stack>
              )}
              {shown.some((o) => o.approx) && <Hint>{shown.find((o) => o.approx)?.note ?? 'Some dates are approximate.'}</Hint>}
            </Section>
          );
        }}
      </Async>
      <AddOccasion onAdded={reload} />
      <Async state={all} lines={3}>
        {(rows) => {
          const shown = rows.filter((o) => !hidden.has(o.id)).sort((a, b) => a.md.localeCompare(b.md));
          return (
            <Section title="All dates" icon={IconCalendar} hint="Birthdays set on a person show above, not here">
              {shown.length === 0 ? (
                <Empty title="No dates saved." />
              ) : (
                <Stack gap={0}>
                  {shown.map((o) => (
                    <Row
                      key={o.id}
                      title={o.name}
                      sub={[o.kind, md(o.md), o.year ? `since ${o.year}` : null, o.note || null].filter(Boolean).join(' · ')}
                      right={
                        <IconBtn
                          icon={IconTrash}
                          label={`Delete ${o.name}`}
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            deleteLater({
                              text: `Deleted ${o.name}`,
                              hide: () => hidden.hide(o.id),
                              restore: () => hidden.show(o.id),
                              run: () => people.removeOccasion(o.id),
                              after: reload,
                            })
                          }
                        />
                      }
                    />
                  ))}
                </Stack>
              )}
            </Section>
          );
        }}
      </Async>
    </>
  );
}

function AddOccasion({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('birthday');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !date || busy) return;
    setBusy(true);
    const r = await act(people.addOccasion({ name: name.trim(), kind, date }), 'Saved');
    setBusy(false);
    if (r) {
      setName('');
      setDate('');
      onAdded();
    }
  };
  return (
    <Section title="Add a date" icon={IconPlus} hint="Repeats every year">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Stack gap="xs">
          <TextInput aria-label="Name" placeholder="Whose or what" value={name} maxLength={80} onChange={(e) => setName(e.currentTarget.value)} />
          <Group grow wrap="nowrap" gap="xs">
            <Select
              aria-label="Kind"
              value={kind}
              onChange={(v) => setKind(v ?? 'other')}
              allowDeselect={false}
              data={OCCASION_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))}
            />
            <TextInput aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
          </Group>
          <Group justify="flex-end">
            <Button type="submit" variant="light" loading={busy} disabled={!name.trim() || !date}>
              Add
            </Button>
          </Group>
        </Stack>
      </form>
    </Section>
  );
}
