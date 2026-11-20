// Shopping: lists, items with tick and clear, shop groups, recipe to list, and past prices.
import { Box, Button, Checkbox, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { life } from '../../life';
import { feel } from '../../sound';
import { emit, toast, useRefresh } from '../../store';
import { Empty, ErrorState, Loading, Section } from '../../ui/Page';
import { v2, type PriceMemory, type ShoppingItem } from '../../v2';
import { moneyApi } from './api';
import { Hint, Readout, Row, toNum } from './kit';
import { commitWrite, readLocal, writeLocal } from './undo';

const DEFAULT_LIST = 'Groceries';
const NEW_LIST = '__new';
const LIST_KEY = 'mosaic.money.shopList';

export function Shopping() {
  const active = usePageActive();
  const [list, setListState] = useState<string>(() => readLocal(LIST_KEY, DEFAULT_LIST));
  const [made, setMade] = useState<string[]>([]);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const setList = (l: string) => {
    setListState(l);
    writeLocal(LIST_KEY, l);
  };

  // The server returns open and ticked items; a tick is saved on the server, so it survives a reload.
  const items = useLoad(() => moneyApi.shopping(), active, [], { key: 'money.shopping' });
  const [over, setOver] = useState<Record<string, boolean>>({}); // optimistic ticks until the reload lands
  useRefresh('money', () => void items.reload());
  const isDone = (i: ShoppingItem) => over[i.id] ?? !!i.done;

  const lists = useMemo(() => {
    const s = new Set<string>([DEFAULT_LIST, ...made, list]);
    for (const i of items.data ?? []) s.add(i.list);
    return [...s];
  }, [items.data, made, list]);

  const mine = (items.data ?? []).filter((i) => i.list === list);
  const ticked = mine.filter(isDone);
  const shown = [...mine.filter((i) => !isDone(i)), ...ticked];

  const toggle = (i: ShoppingItem) => {
    const done = !isDone(i);
    feel('tap');
    setOver((o) => ({ ...o, [i.id]: done }));
    void act(v2.toggleShopping(i.id, done)).then(async (r) => {
      if (r !== null) await items.reload();
      setOver((o) => {
        const n = { ...o };
        delete n[i.id];
        return n;
      });
      emit('money');
    });
  };

  const clear = async () => {
    const r = await act(moneyApi.clearDone(list), 'Cleared');
    if (!r) return;
    setOver({});
    emit('money');
  };

  const counts = (l: string) => (items.data ?? []).filter((i) => i.list === l && !isDone(i)).length;

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
      <Stack gap="md">
        <Section
          title="Shopping list"
          right={
            ticked.length > 0 ? (
              <Button size="compact-sm" variant="subtle" onClick={() => void clear()}>
                Clear {f.num(ticked.length)} bought
              </Button>
            ) : undefined
          }
        >
          <Stack gap="sm">
            {naming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = newName.trim().slice(0, 40);
                  if (!n) return void toast('Name the list');
                  setMade((m) => (m.includes(n) ? m : [...m, n]));
                  setList(n);
                  setNewName('');
                  setNaming(false);
                }}
              >
                <Group gap="xs" align="flex-end" wrap="nowrap">
                  <TextInput
                    style={{ flex: 1 }}
                    label="New list"
                    placeholder="Hardware"
                    value={newName}
                    onChange={(e) => setNewName(e.currentTarget.value)}
                    maxLength={40}
                    autoComplete="off"
                    data-autofocus
                    autoFocus
                  />
                  <Button type="submit">Make</Button>
                  <Button variant="default" onClick={() => setNaming(false)}>
                    Cancel
                  </Button>
                </Group>
              </form>
            ) : (
              <Select
                label="List"
                data={[...lists.map((l) => ({ value: l, label: counts(l) ? `${l} · ${f.num(counts(l))}` : l })), { value: NEW_LIST, label: 'New list…' }]}
                value={list}
                onChange={(v) => {
                  if (!v) return;
                  if (v === NEW_LIST) setNaming(true);
                  else setList(v);
                }}
                allowDeselect={false}
              />
            )}
            <ShopAdd list={list} />
            {items.error && !items.data && <ErrorState error={items.error} onRetry={() => void items.reload()} />}
            {!items.data && !items.error && <Loading label="Loading shopping list" lines={2} />}
            {items.data && shown.length === 0 && <Hint>Nothing on the list.</Hint>}
            {shown.length > 0 && (
              <Stack gap={2}>
                {shown.map((i) => (
                  <Group key={i.id} justify="space-between" wrap="nowrap" py={4}>
                    <Checkbox
                      checked={isDone(i)}
                      onChange={() => toggle(i)}
                      label={
                        <Text size="sm" td={isDone(i) ? 'line-through' : undefined} c={isDone(i) ? 'dimmed' : undefined}>
                          {i.name}
                        </Text>
                      }
                    />
                    {i.qty && (
                      <Text size="xs" c='dimmed' className="num">
                        {i.qty}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Section>
        <ShopGroups list={list} />
      </Stack>
      <Stack gap="md">
        <RecipeToList list={list} />
        <PriceMemorySection />
      </Stack>
    </SimpleGrid>
  );
}

function ShopAdd({ list }: { list: string }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const { done } = await commitWrite(moneyApi.addShopping(name.trim(), list, qty.trim() || undefined));
    setBusy(false);
    emit('money');
    if (!done) return;
    feel('capture');
    setName('');
    setQty('');
    ref.current?.focus();
  };
  return (
    <form onSubmit={submit}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          ref={ref}
          style={{ flex: 1 }}
          label="Add to shopping list"
          placeholder="Eggs"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput w={72} label="Qty" placeholder="12" autoComplete="off" maxLength={20} value={qty} onChange={(e) => setQty(e.currentTarget.value)} />
        <Button type="submit" loading={busy} disabled={!name.trim()} leftSection={<IconPlus size={16} stroke={STROKE} />}>
          Add
        </Button>
      </Group>
    </form>
  );
}

function ShopGroups({ list }: { list: string }) {
  const active = usePageActive();
  const r = useLoad(() => life.shopGroups(list), active, [list], { key: `money.shopGroups.${list}` });
  useRefresh('money', () => void r.reload());
  const g = (r.data ?? []).filter((s) => s.items.some((i) => !i.done));
  if (g.length < 2) return null;
  return (
    <Section title="Shopping by shop">
      <Stack gap="sm">
        {g.map((s) => (
          <Box key={s.store}>
            <Text size="sm" fw={600}>
              {s.store}
            </Text>
            <Text size="sm" c='dimmed'>
              {s.items
                .filter((i) => !i.done)
                .map((i) => i.name + (i.qty ? ` ×${i.qty}` : ''))
                .join(', ')}
            </Text>
          </Box>
        ))}
      </Stack>
    </Section>
  );
}

function RecipeToList({ list }: { list: string }) {
  const active = usePageActive();
  const recipes = useLoad(() => moneyApi.recipes(), active, [], { key: 'money.recipes' });
  const [recipe, setRecipe] = useState<string | null>(null);
  const [portions, setPortions] = useState<string | number>(2);
  const [days, setDays] = useState<string | number>(1);
  const [busy, setBusy] = useState(false);
  const rows = recipes.data ?? [];
  if (recipes.data && rows.length === 0) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recipe) return void toast('Pick a recipe');
    const p = toNum(portions);
    const d = toNum(days);
    if (!Number.isFinite(p) || p <= 0) return void toast('Portions must be a number');
    if (!Number.isFinite(d) || d <= 0) return void toast('Days must be a number');
    setBusy(true);
    const r = await act(moneyApi.recipeToShopping({ recipe, portions: p, days: d, list }));
    setBusy(false);
    if (!r) return;
    feel('capture');
    emit('money');
    const parts = [`Added ${f.num(r.added.length)}`];
    if (r.merged.length) parts.push(`merged ${f.num(r.merged.length)}`);
    if (r.skipped.length) parts.push(`skipped ${f.num(r.skipped.length)}`);
    toast(`${parts.join(' · ')} to ${r.list}`);
  };
  return (
    <Section title="Recipe to list" hint={`Adds what a recipe needs to ${list}.`}>
      {recipes.error && !recipes.data && <ErrorState error={recipes.error} onRetry={() => void recipes.reload()} />}
      {!recipes.data && !recipes.error && <Loading label="Loading recipes" lines={1} />}
      {rows.length > 0 && (
        <form onSubmit={submit}>
          <Stack gap="sm">
            <Select label="Recipe" placeholder="Pick one" data={rows.map((x) => ({ value: x.id, label: x.name }))} value={recipe} onChange={setRecipe} searchable />
            <SimpleGrid cols={2} spacing="sm">
              <NumberInput label="Portions a day" value={portions} onChange={setPortions} min={0.5} step={0.5} decimalScale={1} classNames={{ input: 'num' }} />
              <NumberInput label="Days" value={days} onChange={setDays} min={1} max={60} step={1} allowDecimal={false} classNames={{ input: 'num' }} />
            </SimpleGrid>
            <Button type="submit" loading={busy}>
              Add to {list}
            </Button>
          </Stack>
        </form>
      )}
    </Section>
  );
}

function PriceMemorySection() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<PriceMemory | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await act(v2.priceMemory(t));
    setBusy(false);
    if (r) setRes(r);
  };
  return (
    <Section title="What did I pay?">
      <Stack gap="sm">
        <form onSubmit={search}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              label="Search past prices"
              placeholder="tomatoes, haircut, petrol"
              autoComplete="off"
              enterKeyHint="search"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Button type="submit" loading={busy} disabled={!q.trim()}>
              Look up
            </Button>
          </Group>
        </form>
        {res && res.count === 0 && <Empty title={`No record mentions “${res.q}”.`} />}
        {res && res.count > 0 && (
          <>
            <Readout
              cols={2}
              rows={res.stats.map((s) => ({
                label: `${s.currency} · ${f.plural(s.n, 'time')}`,
                value: f.money(s.last, s.currency),
                sub: `last · ${f.money(s.min, s.currency)}–${f.money(s.max, s.currency)}, avg ${f.money(s.avg, s.currency)}`,
              }))}
            />
            <Box>
              {res.entries.slice(0, 8).map((e, i) => (
                <Row key={i} title={e.note || f.DASH} meta={f.day(e.day)} amount={f.money(e.amount, e.currency)} />
              ))}
            </Box>
          </>
        )}
      </Stack>
    </Section>
  );
}
