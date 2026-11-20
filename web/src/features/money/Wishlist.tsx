// Wishlist: park a want for 72 hours, then buy it or let it go.
import { Button, Group, NumberInput, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, toast, useRefresh } from '../../store';
import { Empty, ErrorState, IconBtn, Loading, Section } from '../../ui/Page';
import { v2, type Wish } from '../../v2';
import { CURRENCIES, Hint, Row, toNum } from './kit';
import { useDeferredDelete } from './undo';

export function Wishlist() {
  const active = usePageActive();
  const list = useLoad(() => v2.wishlist('waiting'), active, [], { key: 'money.wishlist' });
  useRefresh('money', () => void list.reload());
  const del = useDeferredDelete();
  const [name, setName] = useState('');
  const [price, setPrice] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = toNum(price);
    if (!name.trim()) return void toast('What is it?');
    if (!Number.isFinite(p) || p <= 0) return void toast('Price must be a number');
    setBusy(true);
    const r = await act(v2.addWish({ name: name.trim(), price: p, currency: cur }));
    setBusy(false);
    if (!r) return;
    feel('capture');
    toast(`Parked for 72 hours. Ready ${f.day(r.ready_on).toLowerCase()}.`);
    setName('');
    setPrice('');
    void list.reload();
  };

  const status = async (w: Wish, s: 'bought' | 'dropped') => {
    if (await act(v2.wishStatus(w.id, s), s === 'bought' ? 'Marked bought' : 'Let go')) {
      feel(s === 'bought' ? 'done' : 'tap');
      void list.reload();
      emit('money');
    }
  };

  const rows = (list.data ?? []).filter((w) => !del.hidden.has(w.id));

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
      <Section title="Park a want">
        <form onSubmit={add}>
          <Stack gap="sm">
            <Hint>Want something above $20? Park it here. It is ready after 72 hours. If you still want it then, buy it. Under $20 is ready now.</Hint>
            <TextInput label="Item" placeholder="Headphones" autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput
                style={{ flex: 1 }}
                label="Price"
                placeholder="Price"
                value={price}
                onChange={setPrice}
                min={0}
                hideControls
                allowNegative={false}
                inputMode="decimal"
                classNames={{ input: 'num' }}
              />
              <Select w={96} label="Currency" data={CURRENCIES} value={cur} onChange={(v) => v && setCur(v)} allowDeselect={false} />
            </Group>
            <Button type="submit" loading={busy}>
              Park
            </Button>
          </Stack>
        </form>
      </Section>

      <Section title="Waiting" hint={rows.length ? f.plural(rows.length, 'item') : undefined}>
        {list.error && !list.data && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
        {!list.data && !list.error && <Loading label="Loading wishlist" lines={2} />}
        {list.data && rows.length === 0 && <Empty title="Nothing waiting." />}
        {rows.map((w) => (
          <Row
            key={w.id}
            title={w.name}
            meta={`${w.ready ? 'Ready to decide' : `Ready in ${w.hours_left < 1 ? 'under an hour' : f.plural(Math.ceil(w.hours_left), 'hour')}`}${
              w.usd !== null && w.currency !== 'USD' ? ` · ${f.usd(w.usd)}` : ''
            }`}
            amount={f.money(w.price, w.currency)}
            actions={
              <Group gap={4} wrap="nowrap">
                {w.ready && (
                  <Button size="compact-sm" variant="light" onClick={() => void status(w, 'bought')}>
                    Bought
                  </Button>
                )}
                <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void status(w, 'dropped')}>
                  Let go
                </Button>
                <IconBtn
                  icon={IconTrash}
                  size="md"
                  variant="subtle"
                  color="gray"
                  label={`Delete ${w.name}`}
                  onClick={() => del.remove(w.id, w.name, () => v2.deleteWish(w.id), 'money')}
                />
              </Group>
            }
          />
        ))}
      </Section>
    </SimpleGrid>
  );
}
