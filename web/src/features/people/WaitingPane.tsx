import { Badge, Button, Stack } from '@mantine/core';
import { IconCalendar, IconHourglass } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { toast } from '../../store';
import { lifeYmd } from '../../time';
import { Async, Empty, IconBtn, Section } from '../../ui/Page';
import { addDaysYmd, useAsk } from '../review/kit';
import { people } from './client';
import { Row } from './parts';

/* ---------- Waiting ---------- */

export function WaitingPane() {
  const active = usePageActive();
  const w = useLoad(() => people.waiting(), active, [], { key: 'people.waiting' });
  const [askNode, ask] = useAsk();
  const [busy, setBusy] = useState<string | null>(null);
  const today = lifeYmd();
  const setCheck = async (id: string, b: { day?: string; in_days?: number }) => {
    setBusy(id);
    const r = await act(people.checkOn(id, b));
    setBusy(null);
    if (r) {
      toast(`Check on ${f.day(r.check_on)}`);
      void w.reload();
    }
    return !!r;
  };
  return (
    <>
      <Async state={w} lines={3}>
        {(rows) => {
          const sorted = [...rows].sort((a, b) => (a.check_on ?? '9').localeCompare(b.check_on ?? '9'));
          const dueCount = sorted.filter((r) => r.check_on && r.check_on <= today).length;
          return (
            <Section
              title="Waiting for"
              icon={IconHourglass}
              hint={dueCount ? `${f.plural(dueCount, 'check')} due` : 'Tasks tagged waiting'}
            >
              {sorted.length === 0 ? (
                <Empty title="Nothing waiting.">Mark a task as waiting on someone and it shows here with a check date.</Empty>
              ) : (
                <Stack gap={0}>
                  {sorted.map((r) => {
                    const isDue = !!r.check_on && r.check_on <= today;
                    return (
                      <Row
                        key={r.task_id}
                        title={
                          <>
                            {isDue && (
                              <Badge size="xs" variant="light" mr={6}>
                                Check
                              </Badge>
                            )}
                            {r.title}
                          </>
                        }
                        sub={[r.waiting_for ? `waiting for ${r.waiting_for}` : null, r.check_on ? `check ${f.day(r.check_on)}` : 'no check date', r.auto ? 'auto' : null]
                          .filter(Boolean)
                          .join(' · ')}
                        right={
                          <>
                            <Button size="compact-sm" variant="subtle" loading={busy === r.task_id} onClick={() => void setCheck(r.task_id, { in_days: 3 })}>
                              +3d
                            </Button>
                            <IconBtn
                              icon={IconCalendar}
                              label="Pick a check date"
                              variant="subtle"
                              onClick={() =>
                                ask({
                                  title: 'Check on',
                                  label: 'Date',
                                  type: 'date',
                                  initial: r.check_on && r.check_on > today ? r.check_on : addDaysYmd(today, 7),
                                  save: 'Set',
                                  onSave: (v) => setCheck(r.task_id, { day: v }),
                                })
                              }
                            />
                          </>
                        }
                      />
                    );
                  })}
                </Stack>
              )}
            </Section>
          );
        }}
      </Async>
      {askNode}
    </>
  );
}
