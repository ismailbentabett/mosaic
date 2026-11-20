import { Button, Group, NumberInput, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { IconRefresh, IconTool, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { toast, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { Async, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden } from '../review/kit';
import { carApi, SERVICE_KINDS, SERVICE_LABEL, type CarOverview } from './client';
import { NoCar } from './NoCar';
import { changed, DueRow, km, optNum, Row, useOverview, type NumVal } from './shared';

/* ---------- Service ---------- */

export function ServicePane() {
  const active = usePageActive();
  const o = useOverview(active);
  const jobs = useLoad(() => carApi.service(), active, [], { key: 'car.service' });
  useRefresh('car', () => void jobs.reload());
  const hidden = useHidden();
  return (
    <Async state={o} lines={3}>
      {(d) =>
        !d.car ? (
          <NoCar />
        ) : (
          <Stack gap="md">
            {d.due.filter((x) => x.source === 'service' && x.state !== 'later').length > 0 && (
              <Section title="Coming up" icon={IconTool}>
                <Stack gap="sm">
                  {d.due
                    .filter((x) => x.source === 'service' && x.state !== 'later')
                    .map((x) => (
                      <DueRow key={x.id} d={x} />
                    ))}
                </Stack>
              </Section>
            )}
            <Section title="Log a service" icon={IconTool}>
              <ServiceForm currency={d.car.currency} lastKm={d.car.km} intervals={d.intervals} />
            </Section>
            <Section title="History" icon={IconRefresh}>
              <Async state={jobs} lines={3}>
                {(list) =>
                  list.length === 0 ? (
                    <Hint>Nothing logged yet. Start with the last oil change you remember, even roughly.</Hint>
                  ) : (
                    <Stack gap="sm">
                      {list
                        .filter((r) => !hidden.has(r.id))
                        .map((r) => (
                          <Row
                            key={r.id}
                            title={r.title}
                            sub={[
                              f.day(r.day),
                              r.km != null ? km(r.km) : null,
                              r.amount != null ? f.money(r.amount, r.currency) : null,
                              r.garage,
                              r.next_km != null || r.next_day ? `next ${[r.next_km != null ? km(r.next_km) : null, r.next_day ? f.day(r.next_day) : null].filter(Boolean).join(' or ')}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                            right={
                              <IconBtn
                                icon={IconTrash}
                                label="Delete service"
                                variant="subtle"
                                color="gray"
                                size="md"
                                onClick={() =>
                                  deleteLater({
                                    text: `${r.title} removed`,
                                    hide: () => hidden.hide(r.id),
                                    restore: () => hidden.show(r.id),
                                    run: () => carApi.removeService(r.id),
                                    after: () => changed(true),
                                  })
                                }
                              />
                            }
                          />
                        ))}
                    </Stack>
                  )
                }
              </Async>
            </Section>
          </Stack>
        )
      }
    </Async>
  );
}

function ServiceForm({ currency, lastKm, intervals }: { currency: string; lastKm: number | null; intervals: CarOverview['intervals'] }) {
  const [kind, setKind] = useState<string>('oil');
  const [title, setTitle] = useState('');
  const [kmV, setKmV] = useState<NumVal>('');
  const [amount, setAmount] = useState<NumVal>('');
  const [garage, setGarage] = useState('');
  const [day, setDay] = useState(lifeYmd());
  const [busy, setBusy] = useState(false);
  const gap = intervals[kind];
  const gapText = gap && (gap.km || gap.months) ? `Next one is set ${[gap.km ? `${km(gap.km)}` : null, gap.months ? `${gap.months} months` : null].filter(Boolean).join(' or ')} later.` : 'No usual gap: nothing is scheduled.';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act(
      carApi.addService({ kind, title: title.trim() || undefined, km: optNum(kmV), amount: optNum(amount), garage: garage.trim() || undefined, day: day || undefined }),
      'Service saved',
    );
    setBusy(false);
    if (r === null) return;
    if (r.money_note) toast(r.money_note);
    setTitle('');
    setKmV('');
    setAmount('');
    setGarage('');
    changed(r.record_id != null);
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
          <Select label="What" data={SERVICE_KINDS.map((k) => ({ value: k, label: SERVICE_LABEL[k] }))} value={kind} onChange={(v) => setKind(v ?? 'oil')} allowDeselect={false} />
          <TextInput label="Date" type="date" value={day} max={lifeYmd()} onChange={(e) => setDay(e.currentTarget.value)} />
          <NumberInput
            label="Odometer (km)"
            value={kmV}
            onChange={setKmV}
            min={0}
            hideControls
            allowDecimal={false}
            thousandSeparator=" "
            description={lastKm ? `Last ${km(lastKm)}` : 'Optional'}
          />
          <NumberInput label={`Amount (${currency})`} value={amount} onChange={setAmount} min={0} hideControls thousandSeparator=" " description="Optional" />
          <TextInput label="Garage" placeholder="Optional" value={garage} maxLength={80} onChange={(e) => setGarage(e.currentTarget.value)} />
          <TextInput label="Title" placeholder={SERVICE_LABEL[kind]} value={title} maxLength={80} onChange={(e) => setTitle(e.currentTarget.value)} />
        </SimpleGrid>
        <Group justify="space-between" align="center" gap="sm">
          <Hint>{gapText}</Hint>
          <Button type="submit" loading={busy}>
            Save service
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
