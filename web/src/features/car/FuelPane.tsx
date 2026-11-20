import { Button, Checkbox, Group, NumberInput, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { IconGasStation, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { toast, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { Async, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useHidden } from '../review/kit';
import { carApi } from './client';
import { NoCar } from './NoCar';
import { changed, km, optNum, Row, useOverview, type NumVal } from './shared';

/* ---------- Fuel ---------- */

export function FuelPane() {
  const active = usePageActive();
  const o = useOverview(active);
  const fills = useLoad(() => carApi.fuel(), active, [], { key: 'car.fuel' });
  useRefresh('car', () => void fills.reload());
  const hidden = useHidden();
  return (
    <Async state={o} lines={3}>
      {(d) =>
        !d.car ? (
          <NoCar />
        ) : (
          <Stack gap="md">
            <Section title="Log a fill" icon={IconGasStation} hint={d.car.tank_l ? `Tank ${f.fixed(d.car.tank_l, 0)} L` : undefined}>
              <FuelForm currency={d.car.currency} lastKm={d.car.km} />
            </Section>
            <Section title="Fills" icon={IconGasStation} hint={d.economy?.avg != null ? `Avg ${f.fixed(d.economy.avg)} L/100 km` : undefined}>
              <Async state={fills} lines={3}>
                {(list) =>
                  list.length === 0 ? (
                    <Hint>No fills yet. Log two full fills with the km to see fuel use.</Hint>
                  ) : (
                    <Stack gap="sm">
                      {list
                        .filter((r) => !hidden.has(r.id))
                        .map((r) => (
                          <Row
                            key={r.id}
                            title={
                              <span className="num">
                                {f.day(r.day)} · {r.litres != null ? `${f.fixed(r.litres)} L` : f.DASH}
                                {r.amount != null ? ` · ${f.money(r.amount, r.currency)}` : ''}
                              </span>
                            }
                            sub={[
                              r.km != null ? km(r.km) : null,
                              r.l_per_100 != null ? `${f.fixed(r.l_per_100)} L/100 km` : null,
                              r.price_per_l != null ? `${f.money(r.price_per_l, r.currency)}/L` : null,
                              r.full ? null : 'not full',
                              r.station,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                            right={
                              <IconBtn
                                icon={IconTrash}
                                label="Delete fill"
                                variant="subtle"
                                color="gray"
                                size="md"
                                onClick={() =>
                                  deleteLater({
                                    text: 'Fill removed',
                                    hide: () => hidden.hide(r.id),
                                    restore: () => hidden.show(r.id),
                                    run: () => carApi.removeFuel(r.id),
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

function FuelForm({ currency, lastKm }: { currency: string; lastKm: number | null }) {
  const [litres, setLitres] = useState<NumVal>('');
  const [amount, setAmount] = useState<NumVal>('');
  const [ppl, setPpl] = useState<NumVal>('');
  const [kmV, setKmV] = useState<NumVal>('');
  const [full, setFull] = useState(true);
  const [station, setStation] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const l = optNum(litres);
    const a = optNum(amount);
    const p = optNum(ppl);
    if (l === undefined && a === undefined) return void toast('Give the litres or the amount');
    setBusy(true);
    const r = await act(
      carApi.addFuel({ litres: l, amount: a, price_per_l: p, km: optNum(kmV), full, station: station.trim() || undefined, day: lifeYmd() }),
      'Fill saved',
    );
    setBusy(false);
    if (r === null) return;
    if (r.money_note) toast(r.money_note);
    setLitres('');
    setAmount('');
    setKmV('');
    setStation('');
    changed(r.record_id != null);
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <NumberInput label="Litres" value={litres} onChange={setLitres} min={0} decimalScale={2} hideControls />
          <NumberInput label={`Amount (${currency})`} value={amount} onChange={setAmount} min={0} hideControls thousandSeparator=" " />
          <NumberInput label="Price per litre" value={ppl} onChange={setPpl} min={0} decimalScale={2} hideControls description="Optional" />
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
        </SimpleGrid>
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
          <TextInput label="Station" placeholder="Optional" value={station} maxLength={80} onChange={(e) => setStation(e.currentTarget.value)} style={{ flex: 1, minWidth: 160 }} />
          <Checkbox label="Filled to the top" checked={full} onChange={(e) => setFull(e.currentTarget.checked)} mb={8} />
          <Button type="submit" loading={busy}>
            Save fill
          </Button>
        </Group>
        <Hint>Two of litres, amount and price per litre are enough. The amount also goes to Money.</Hint>
      </Stack>
    </form>
  );
}
