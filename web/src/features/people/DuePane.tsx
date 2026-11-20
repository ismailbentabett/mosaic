import { Button, Stack } from '@mantine/core';
import { IconMessageCircle, IconPencil, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { PLACE_ICON } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { deleteLater, useAsk, useHidden } from '../review/kit';
import { people, type Person } from './client';
import { md, ReachLinks, Row, sinceText } from './parts';
import { PersonSheet } from './PersonSheet';

/* ---------- Due ---------- */

export function DuePane() {
  const active = usePageActive();
  const due = useLoad(() => people.due(), active, [], { key: 'people.due' });
  const all = useLoad(() => people.list(), active, [], { key: 'people.all' });
  const hidden = useHidden();
  const [askNode, ask] = useAsk();
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => {
    void due.reload();
    void all.reload();
  };
  const talked = async (id: string, name: string, note = '') => {
    setBusy(id);
    const r = await act(people.touch(id, note), `Noted: ${name}`);
    setBusy(null);
    if (r) reload();
    return !!r;
  };
  const remove = (p: Person) =>
    deleteLater({
      text: `Removed ${p.name}`,
      hide: () => hidden.hide(p.id),
      restore: () => hidden.show(p.id),
      run: () => people.remove(p.id),
      after: reload,
    });

  return (
    <>
      <Async state={due} lines={3}>
        {(rows) => (
          <Section title="Due to reach" icon={IconMessageCircle} hint="Past their usual gap">
            {rows.length === 0 ? (
              <Empty title="Nobody is due.">Set a gap on someone to see them here when it passes.</Empty>
            ) : (
              <Stack gap={0}>
                {rows.map((p) => (
                  <Row
                    key={p.id}
                    title={p.name}
                    sub={`${p.relation} · ${sinceText(p.days_since)}${p.cadence_days ? ` · every ${f.plural(p.cadence_days, 'day')}` : ''}`}
                    right={
                      <>
                        <ReachLinks name={p.name} phone={p.phone} />
                        <IconBtn
                          icon={IconPencil}
                          label={`Talked to ${p.name}, with a note`}
                          variant="subtle"
                          onClick={() =>
                            ask({
                              title: `Talked to ${p.name}`,
                              label: 'Note',
                              placeholder: 'What about (optional)',
                              allowEmpty: true,
                              save: 'Save',
                              onSave: (v) => talked(p.id, p.name, v),
                            })
                          }
                        />
                        <Button size="compact-sm" variant="light" loading={busy === p.id} onClick={() => void talked(p.id, p.name)}>
                          Talked
                        </Button>
                      </>
                    }
                  />
                ))}
              </Stack>
            )}
          </Section>
        )}
      </Async>

      <Async state={all} lines={4}>
        {(rows) => {
          const list = rows.filter((p) => !hidden.has(p.id));
          return (
            <Section
              title="Everyone"
              icon={PLACE_ICON.people}
              hint={f.plural(list.length, 'person', 'people')}
              right={<IconBtn icon={IconUserPlus} label="Add person" variant="subtle" onClick={() => setEdit('new')} />}
            >
              {list.length === 0 ? (
                <Empty title="No one added yet." action={<Button variant="light" onClick={() => setEdit('new')}>Add person</Button>}>
                  Family and friends only.
                </Empty>
              ) : (
                <Stack gap={0}>
                  {list.map((p) => (
                    <Row
                      key={p.id}
                      title={p.name}
                      onClick={() => setEdit(p)}
                      sub={[
                        p.relation,
                        p.cadence_days ? `every ${f.plural(p.cadence_days, 'day')}` : null,
                        p.birthday ? `birthday ${md(p.birthday)}` : null,
                        p.last_contact ? `last ${f.day(p.last_contact)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      right={
                        <>
                          <ReachLinks name={p.name} phone={p.phone} />
                          <Button size="compact-sm" variant="subtle" loading={busy === p.id} onClick={() => void talked(p.id, p.name)}>
                            Talked
                          </Button>
                          <IconBtn icon={IconTrash} label={`Remove ${p.name}`} variant="subtle" color="gray" onClick={() => remove(p)} />
                        </>
                      }
                    />
                  ))}
                </Stack>
              )}
            </Section>
          );
        }}
      </Async>
      <PersonSheet value={edit} onClose={() => setEdit(null)} onSaved={reload} />
      {askNode}
    </>
  );
}
