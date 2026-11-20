// Money records: quick log, log-again chips, filters, day-grouped list with edit and delete (Undo).
import { Box, Button, Divider, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, TagsInput, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPencil, IconSearch, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { STROKE } from '../../app/icons';
import { copy } from '../../copy';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, toast, toastUndo, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { Empty, ErrorState, IconBtn, Loading, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { v2, type Category, type MoneyRecord } from '../../v2';
import { moneyApi, WHO_DEFAULTS, type RecordPatch } from './api';
import { Blur } from './blur';
import { Hint, Row, toNum } from './kit';
import { daysBefore, monthStart, recordText, recordTitle } from './recordText';
import { commitWrite, parseNum, useDeferredDelete } from './undo';

type Range = '7d' | '30d' | 'month' | 'all';
type KindFilter = 'all' | 'expense' | 'income';

export function Records() {
  const active = usePageActive();
  const today = lifeYmd();
  const del = useDeferredDelete();

  const [range, setRange] = useState<Range>('30d');
  const [kind, setKind] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [category, setCategory] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [editing, setEditing] = useState<MoneyRecord | null>(null);

  const from = range === '7d' ? daysBefore(today, 6) : range === '30d' ? daysBefore(today, 29) : range === 'month' ? monthStart(today) : undefined;
  const list = useLoad(
    () =>
      moneyApi.records({
        from,
        to: from ? today : undefined,
        q: q || undefined,
        category: category ?? undefined,
        account: account ?? undefined,
        kind: kind === 'all' ? undefined : kind,
        limit: 500,
      }),
    active,
    [from, today, q, category, account, kind],
    { key: `money.records.${from ?? 'all'}.${q}.${category ?? ''}.${account ?? ''}.${kind}` },
  );
  const recent = useLoad(() => v2.records({ limit: 40 }), active, [], { key: 'money.recent' });
  const cats = useLoad(() => v2.categories(), active, [], { key: 'money.categories' });
  const accts = useLoad(() => v2.accounts(), active, [], { key: 'money.accounts' });
  useRefresh('money', () => {
    void list.reload();
    void recent.reload();
  });

  const saveText = (text: string) => saveWith(v2.quickLog(text));
  const saveFields = (b: LogFields) => saveWith(moneyApi.logRecord(b));
  const saveWith = async (w: Promise<MoneyRecord>): Promise<boolean> => {
    const { r, done } = await commitWrite(w);
    emit('money');
    if (!r) return done;
    feel('capture');
    const cat = r.category_name;
    toastUndo(`${r.kind === 'income' ? 'Income' : 'Spent'} ${f.money(r.amount, r.currency)}${cat ? ` · ${cat}` : ''}`, () => {
      feel('undo');
      void act(v2.deleteRecord(r.id)).then(() => emit('money'));
    });
    return true;
  };

  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: MoneyRecord[] = [];
    for (const r of recent.data ?? []) {
      if (r.kind === 'transfer' || del.hidden.has(r.id)) continue;
      const t = recordText(r);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(r);
      if (out.length >= 6) break;
    }
    return out;
  }, [recent.data, del.hidden]);

  // The server filters by kind; the check here only hides rows from a stale load while the new one lands.
  const rows = (list.data ?? []).filter((r) => !del.hidden.has(r.id) && (kind === 'all' || r.kind === kind));
  const groups = useMemo(() => {
    const m = new Map<string, MoneyRecord[]>();
    for (const r of rows) {
      const g = m.get(r.day);
      if (g) g.push(r);
      else m.set(r.day, [r]);
    }
    return [...m.entries()];
  }, [rows]);

  const expenseCats = (cats.data ?? []).filter((c) => c.kind === 'expense');
  const catOptions = [...new Set(expenseCats.map((c) => c.name))];
  const acctOptions = (accts.data ?? []).filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }));
  const filtered = !!q || !!category || !!account || kind !== 'all';

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
      <Stack gap="md">
        <Section title="Log">
          <LogForm onSave={saveFields} />
          {chips.length > 0 && (
            <Box mt="md">
              <Text size="xs" c="dimmed" mb={6}>
                Log again
              </Text>
              <Group gap={6}>
                {chips.map((r) => {
                  const { title } = recordTitle(r);
                  const income = r.kind === 'income';
                  return (
                    <Button
                      key={r.id}
                      size="compact-sm"
                      radius="xl"
                      variant="default"
                      aria-label={`Log again: ${income ? 'income' : 'spent'} ${f.money(r.amount, r.currency)}, ${title}`}
                      onClick={() => void saveText(recordText(r))}
                    >
                      <Text span size="sm" className="num">
                        <Blur inline>
                          {income ? '+' : ''}
                          {f.money(r.amount, r.currency)}
                        </Blur>
                      </Text>
                      <Text span size="sm" ml={6}>
                        {title}
                      </Text>
                    </Button>
                  );
                })}
              </Group>
            </Box>
          )}
        </Section>

        <Section title="Filters">
          <Stack gap="sm">
            <TextInput
              aria-label="Search notes and payees"
              placeholder="Search notes and payees"
              leftSection={<IconSearch size={16} stroke={STROKE} />}
              enterKeyHint="search"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              autoComplete="off"
            />
            <SegmentedControl
              fullWidth
              value={range}
              onChange={(v) => setRange(v as Range)}
              aria-label="Date range"
              data={[
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: 'month', label: 'Month' },
                { value: 'all', label: 'All' },
              ]}
            />
            <SegmentedControl
              fullWidth
              value={kind}
              onChange={(v) => setKind(v as KindFilter)}
              aria-label="Kind"
              data={[
                { value: 'all', label: 'All' },
                { value: 'expense', label: 'Spent' },
                { value: 'income', label: 'Income' },
              ]}
            />
            <SimpleGrid cols={2} spacing="sm">
              <Select label="Category" placeholder="Any" data={catOptions} value={category} onChange={setCategory} clearable searchable />
              <Select label="Account" placeholder="Any" data={acctOptions} value={account} onChange={setAccount} clearable />
            </SimpleGrid>
          </Stack>
        </Section>
      </Stack>

      <Section title="History" hint={list.data ? f.plural(rows.length, 'record') : undefined}>
        {!list.data && list.error && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
        {!list.data && !list.error && <Loading label="Loading records" lines={4} />}
        {list.data && rows.length === 0 && (
          <Empty title={filtered ? copy.empty.search : copy.empty.money}>{filtered ? 'Change a filter.' : 'Log the next thing you pay for.'}</Empty>
        )}
        {groups.map(([day, rs], gi) => {
          const spent = rs.reduce((s, r) => (r.kind === 'expense' ? s + (r.usd ?? 0) : s), 0);
          return (
            <Box key={day} mt={gi ? 'sm' : 0}>
              <Group justify="space-between" mb={2}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  {f.dayHead(day)}
                </Text>
                {spent > 0 && (
                  <Text size="xs" c="dimmed" className="num">
                    <Blur inline>{f.usd(spent)}</Blur>
                  </Text>
                )}
              </Group>
              <Divider mb={2} />
              {rs.map((r) => {
                const { title, same } = recordTitle(r);
                const label = `${title}, ${f.money(r.amount, r.currency)}, ${f.day(r.day).toLowerCase()}`;
                const meta = [same || title === r.category_name ? null : r.category_name, r.account_name, r.labels?.length ? r.labels.map((l) => `#${l}`).join(' ') : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Row
                    key={r.id}
                    title={title}
                    meta={meta || undefined}
                    amount={
                      <>
                        {r.kind === 'income' ? '+' : r.kind === 'transfer' ? (r.direction > 0 ? '→ ' : '← ') : ''}
                        {f.money(r.amount, r.currency)}
                        {r.currency !== 'USD' && r.usd !== null && (
                          <Text span size="xs" c="dimmed" ml={6}>
                            {f.usd(r.usd)}
                          </Text>
                        )}
                      </>
                    }
                    actions={
                      <Group gap={0} wrap="nowrap">
                        {r.kind !== 'transfer' && (
                          <IconBtn icon={IconPencil} size="md" variant="subtle" color="gray" label={`Edit ${label}`} onClick={() => setEditing(r)} />
                        )}
                        <IconBtn
                          icon={IconTrash}
                          size="md"
                          variant="subtle"
                          color="gray"
                          label={`Delete ${label}`}
                          onClick={() => del.remove(r.id, title, () => v2.deleteRecord(r.id), 'money')}
                        />
                      </Group>
                    }
                  />
                );
              })}
            </Box>
          );
        })}
      </Section>

      <EditSheet record={editing} categories={cats.data ?? []} onClose={() => setEditing(null)} />
    </SimpleGrid>
  );
}

type LogFields = { kind: 'expense' | 'income'; amount: number; currency: string; note?: string };

function LogForm({ onSave }: { onSave: (b: LogFields) => Promise<boolean> }) {
  const [income, setIncome] = useState(false);
  const [usd, setUsd] = useState(true);
  const [amount, setAmount] = useState('');
  const [what, setWhat] = useState('');
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = parseNum(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      toast('Type an amount');
      amountRef.current?.focus();
      return;
    }
    // Fields go as fields: the note is never parsed for an amount or a currency.
    setBusy(true);
    const ok = await onSave({ kind: income ? 'income' : 'expense', amount: n, currency: usd ? 'USD' : 'EUR', note: what.trim() || undefined });
    setBusy(false);
    if (!ok) return;
    setAmount('');
    setWhat('');
    amountRef.current?.focus();
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <SimpleGrid cols={2} spacing="sm">
          <SegmentedControl
            value={income ? 'income' : 'expense'}
            onChange={(v) => setIncome(v === 'income')}
            aria-label="Kind"
            data={[
              { value: 'expense', label: 'Spent' },
              { value: 'income', label: 'Income' },
            ]}
          />
          <SegmentedControl
            value={usd ? 'USD' : 'EUR'}
            onChange={(v) => setUsd(v === 'USD')}
            aria-label="Currency"
            data={[
              { value: 'USD', label: 'Dollars' },
              { value: 'EUR', label: 'Euros' },
            ]}
          />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          <TextInput
            ref={amountRef}
            label={usd ? 'Amount ($)' : 'Amount (€)'}
            placeholder={usd ? '12' : '10'}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            classNames={{ input: 'num' }}
          />
          <TextInput
            label="What"
            placeholder={income ? 'Salary' : 'Coffee'}
            enterKeyHint="done"
            autoComplete="off"
            maxLength={200}
            value={what}
            onChange={(e) => setWhat(e.currentTarget.value)}
          />
        </SimpleGrid>
        <Button type="submit" loading={busy} fullWidth>
          {income ? 'Log income' : 'Log expense'}
        </Button>
        <Hint>The category comes from what you type. Offline, it saves on this phone and sends later.</Hint>
      </Stack>
    </form>
  );
}

const KEEP = '__keep';
const CLEAR = '__clear';

function EditSheet({ record, categories, onClose }: { record: MoneyRecord | null; categories: Category[]; onClose: () => void }) {
  return (
    <Sheet opened={!!record} onClose={onClose} title="Edit record">
      {record && <EditForm key={record.id} r={record} categories={categories} onDone={onClose} />}
    </Sheet>
  );
}

function EditForm({ r, categories, onDone }: { r: MoneyRecord; categories: Category[]; onDone: () => void }) {
  const [kind, setKind] = useState<'expense' | 'income'>(r.kind === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState<string | number>(r.amount);
  const [day, setDay] = useState(r.day);
  const [category, setCategory] = useState<string | null>(r.category_name || null);
  const [note, setNote] = useState(r.note ?? '');
  const [payee, setPayee] = useState(r.payee ?? '');
  const [labels, setLabels] = useState<string[]>(r.labels ?? []);
  const [who, setWho] = useState<string>(KEEP);
  const [cur, setCur] = useState<string | null>(null); // the saved "For" tag
  const [busy, setBusy] = useState(false);
  const catOptions = [...new Set(categories.filter((c) => c.kind === kind).map((c) => c.name))];
  const personal = kind === 'expense' && (r.track ?? 'personal') === 'personal';
  useEffect(() => {
    if (!personal) return;
    let live = true;
    moneyApi.getRecordFor(r.id).then(
      (x) => live && setCur(x.who),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [r.id, personal]);
  const whoOptions = [
    ...(cur ? [] : [{ value: KEEP, label: 'Not tagged' }]),
    ...[...new Set([...WHO_DEFAULTS, ...(cur ? [cur] : [])])].map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) })),
    ...(cur ? [{ value: CLEAR, label: 'Clear the tag' }] : []),
  ];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = toNum(amount);
    if (!Number.isFinite(n) || n <= 0) return void toast('Amount must be more than 0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return void toast('Pick a day');
    const p: RecordPatch = {};
    const back: RecordPatch = {};
    if (kind !== r.kind) {
      p.kind = kind;
      back.kind = r.kind as 'expense' | 'income';
    }
    if (n !== r.amount) {
      p.amount = n;
      back.amount = r.amount;
    }
    if (day !== r.day) {
      p.day = day;
      back.day = r.day;
    }
    if ((category ?? '') !== (r.category_name ?? '') || p.kind) {
      p.category = category ?? '';
      back.category = r.category_name ?? '';
    }
    if (note.trim() !== (r.note ?? '')) {
      p.note = note.trim();
      back.note = r.note ?? '';
    }
    if (payee.trim() !== (r.payee ?? '')) {
      p.payee = payee.trim();
      back.payee = r.payee ?? '';
    }
    if (labels.join('\u0000') !== (r.labels ?? []).join('\u0000')) {
      p.labels = labels;
      back.labels = r.labels ?? [];
    }
    const whoChange = personal && who !== KEEP && who !== cur && !(who === CLEAR && !cur);
    if (!Object.keys(p).length && !whoChange) return onDone();
    setBusy(true);
    let ok = true;
    if (Object.keys(p).length) ok = !!(await act(moneyApi.updateRecord(r.id, p)));
    if (ok && whoChange) ok = (await act(moneyApi.setRecordFor(r.id, who === CLEAR ? null : who))) !== null;
    setBusy(false);
    if (!ok) return;
    emit('money');
    feel('done');
    onDone();
    if (Object.keys(back).length) {
      toastUndo(copy.toast.saved, () => {
        feel('undo');
        void act(moneyApi.updateRecord(r.id, back), copy.toast.undone).then(() => emit('money'));
      });
    } else toast(copy.toast.saved);
  };

  return (
    <form onSubmit={save}>
      <Stack gap="sm">
        <SegmentedControl
          value={kind}
          onChange={(v) => setKind(v as 'expense' | 'income')}
          aria-label="Kind"
          data={[
            { value: 'expense', label: 'Spent' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput label={`Amount (${r.currency})`} value={amount} onChange={setAmount} min={0} hideControls allowNegative={false} inputMode="decimal" />
          <TextInput label="Day" type="date" value={day} onChange={(e) => setDay(e.currentTarget.value)} max={lifeYmd()} />
        </SimpleGrid>
        <Select label="Category" placeholder="None" data={catOptions} value={category} onChange={setCategory} clearable searchable />
        <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} autoComplete="off" />
        <TextInput label="Payee" value={payee} onChange={(e) => setPayee(e.currentTarget.value)} maxLength={120} autoComplete="off" />
        <TagsInput label="Labels" value={labels} onChange={setLabels} placeholder="family, trip" clearable />
        {personal && (
          <Select
            label="For"
            description="Who this expense was for."
            data={whoOptions}
            value={who === KEEP ? (cur ?? KEEP) : who}
            onChange={(v) => setWho(v ?? KEEP)}
            allowDeselect={false}
          />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
