import { Button, Group, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { IconArrowBackUp, IconCalendar, IconHeartHandshake, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { life } from '../../life';
import { lifeYmd } from '../../time';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { deleteLater, useHidden, whenText } from '../review/kit';
import { people, type PromiseRow, type PromiseStatus } from './client';
import { Row } from './parts';

/* ---------- Promises ---------- */

const PROMISE_FILTERS: { value: PromiseStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'kept', label: 'Kept' },
  { value: 'released', label: 'Released' },
  { value: 'all', label: 'All' },
];

export function PromisesPane() {
  const active = usePageActive();
  const [status, setStatus] = useState<PromiseStatus | 'all'>('open');
  const soon = useLoad(() => life.promisesSoon(), active, [], { key: 'people.promises.soon' });
  const list = useLoad(() => people.promises(status), active, [status], { key: `people.promises.${status}` });
  const hidden = useHidden();
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => {
    void soon.reload();
    void list.reload();
  };
  const run = async (id: string, p: Promise<unknown>, ok: string) => {
    setBusy(id);
    const r = await act(p, ok);
    setBusy(null);
    if (r) reload();
  };
  const remove = (p: PromiseRow) =>
    deleteLater({
      text: 'Promise deleted',
      hide: () => hidden.hide(p.id),
      restore: () => hidden.show(p.id),
      run: () => people.removePromise(p.id),
      after: reload,
    });
  const soonRows = (soon.data ?? []).filter((p) => !hidden.has(p.id));

  return (
    <>
      <AddPromise onAdded={reload} />
      {soonRows.length > 0 && (
        <Section title="Coming up" icon={IconCalendar}>
          <Stack gap={0}>
            {soonRows.map((p) => (
              <Row
                key={p.id}
                title={`${p.who}: ${p.what}`}
                sub={p.days_until != null ? whenText(p.days_until) : p.due ? f.day(p.due) : undefined}
                right={
                  <Button size="compact-sm" variant="light" loading={busy === p.id} onClick={() => void run(p.id, people.keep(p.id), 'Kept')}>
                    Kept
                  </Button>
                }
              />
            ))}
          </Stack>
        </Section>
      )}
      <Section
        title="Promises"
        icon={IconHeartHandshake}
        right={
          <SegmentedControl
            size="xs"
            value={status}
            onChange={(v) => setStatus(v as PromiseStatus | 'all')}
            data={PROMISE_FILTERS}
          />
        }
      >
        <Async state={list} lines={3}>
          {(rows) => {
            const shown = rows.filter((p) => !hidden.has(p.id));
            if (shown.length === 0) return <Empty title={status === 'open' ? 'No open promises.' : 'Nothing here.'} />;
            return (
              <Stack gap={0}>
                {shown.map((p) => (
                  <Row
                    key={p.id}
                    title={`${p.who}: ${p.what}`}
                    sub={
                      p.status === 'open'
                        ? p.due
                          ? `due ${f.day(p.due)}`
                          : 'no date'
                        : `${p.status}${p.closed_day ? ` ${f.day(p.closed_day)}` : ''}`
                    }
                    right={
                      <>
                        {p.status === 'open' ? (
                          <>
                            <Button size="compact-sm" variant="light" loading={busy === p.id} onClick={() => void run(p.id, people.keep(p.id), 'Kept')}>
                              Kept
                            </Button>
                            <IconBtn
                              icon={IconX}
                              label="Release this promise"
                              variant="subtle"
                              color="gray"
                              onClick={() => void run(p.id, people.release(p.id), 'Released')}
                            />
                          </>
                        ) : (
                          <IconBtn
                            icon={IconArrowBackUp}
                            label="Reopen"
                            variant="subtle"
                            onClick={() => void run(p.id, people.reopen(p.id), 'Reopened')}
                          />
                        )}
                        <IconBtn icon={IconTrash} label="Delete promise" variant="subtle" color="gray" onClick={() => remove(p)} />
                      </>
                    }
                  />
                ))}
              </Stack>
            );
          }}
        </Async>
      </Section>
    </>
  );
}

function AddPromise({ onAdded }: { onAdded: () => void }) {
  const [who, setWho] = useState('');
  const [what, setWhat] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!who.trim() || !what.trim() || busy) return;
    setBusy(true);
    const r = await act(people.addPromise({ who: who.trim(), what: what.trim(), due: due || null }), 'Promise saved');
    setBusy(false);
    if (r) {
      setWho('');
      setWhat('');
      setDue('');
      onAdded();
    }
  };
  return (
    <Section title="New promise" icon={IconPlus}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Stack gap="xs">
          <Group grow wrap="nowrap" gap="xs">
            <TextInput aria-label="To whom" placeholder="To whom" value={who} maxLength={60} onChange={(e) => setWho(e.currentTarget.value)} />
            <TextInput aria-label="By when" type="date" value={due} min={lifeYmd()} onChange={(e) => setDue(e.currentTarget.value)} />
          </Group>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              aria-label="What you promised"
              placeholder="What you promised"
              value={what}
              maxLength={160}
              onChange={(e) => setWhat(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button type="submit" variant="light" loading={busy} disabled={!who.trim() || !what.trim()}>
              Add
            </Button>
          </Group>
        </Stack>
      </form>
    </Section>
  );
}
