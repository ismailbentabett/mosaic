// Budgets and savings goals: the weekly budget, other budgets, and saving goals. Each can be set,
// edited and removed here (and from MCP: money_budget, money_savings). Dollars first, euros second.
import { Box, Button, Group, NumberInput, Progress, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, toast, toastUndo, useRefresh } from '../../store';
import { ErrorState, IconBtn, Loading, Section } from '../../ui/Page';
import { v2, type Budget, type Savings } from '../../v2';
import { Blur } from './blur';
import { Hint, toNum, useFx } from './kit';

type Fx = ReturnType<typeof useFx>;

/** An amount typed in USD or EUR → USD. Null (with a toast) when it cannot be converted. */
function toUsd(v: string | number, cur: string, dz: Fx): number | null {
  const n = toNum(v);
  if (!Number.isFinite(n) || n <= 0) {
    toast('Amount must be a number above 0');
    return null;
  }
  if (cur === 'USD') return n;
  if (!dz.perUsd) {
    toast('No EUR rate yet. Set one under Accounts → Rate, or type the amount in USD.');
    return null;
  }
  return Math.round((n / dz.perUsd) * 100) / 100;
}

function AmountField({ value, onChange, cur, setCur, label }: { value: string | number; onChange: (v: string | number) => void; cur: string; setCur: (c: string) => void; label: string }) {
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap" style={{ flex: 1 }}>
      <NumberInput label={label} value={value} onChange={onChange} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
      <Select label="In" data={['USD', 'EUR']} value={cur} onChange={(c) => c && setCur(c)} allowDeselect={false} w={86} />
    </Group>
  );
}

export function Budgets() {
  const active = usePageActive();
  const budgets = useLoad(() => v2.budgets(), active, [], { key: 'money.budgets' });
  const savings = useLoad(() => v2.savings(), active, [], { key: 'money.savings' });
  const dz = useFx();
  useRefresh('money', () => {
    void budgets.reload();
    void savings.reload();
  });

  if (budgets.error && !budgets.data) return <ErrorState error={budgets.error} onRetry={() => void budgets.reload()} />;
  if (savings.error && !savings.data) return <ErrorState error={savings.error} onRetry={() => void savings.reload()} />;
  if (!budgets.data || !savings.data) return <Loading label="Loading budgets" lines={3} />;

  const weekly = budgets.data.find((b) => b.period === 'week' && !(b.category_ids ?? []).length) ?? null;
  const others = budgets.data.filter((b) => b !== weekly);

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
      <Stack gap="md">
        <WeeklyBudget b={weekly} dz={dz} />
        <Section title="Other budgets">
          <Stack gap="md">
            {others.length === 0 && <Hint>None yet. Add one for a month or a year.</Hint>}
            {others.map((b) => (
              <BudgetRow key={b.id} b={b} dz={dz} />
            ))}
            <AddBudget dz={dz} />
          </Stack>
        </Section>
      </Stack>
      <Section title="Saving for">
        <Stack gap="md">
          {savings.data.length === 0 && <Hint>No saving goal yet.</Hint>}
          {savings.data.map((g) => (
            <SavingsRow key={g.id} g={g} dz={dz} />
          ))}
          <AddSavings dz={dz} />
        </Stack>
      </Section>
    </SimpleGrid>
  );
}

const share = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);

function WeeklyBudget({ b, dz }: { b: Budget | null; dz: Fx }) {
  const [amount, setAmount] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const usd = toUsd(amount, cur, dz);
    if (usd === null) return;
    setBusy(true);
    const r = await act(v2.setWeeklyBudget(usd), 'Weekly budget saved');
    setBusy(false);
    if (r) {
      setAmount('');
      emit('money');
    }
  };
  return (
    <Section title="Weekly budget">
      <Stack gap="sm">
        {b ? <BudgetBody b={b} dz={dz} /> : <Hint>Not set. Free to spend uses it.</Hint>}
        <form onSubmit={save}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <AmountField label={b ? 'New weekly amount' : 'Weekly amount'} value={amount} onChange={setAmount} cur={cur} setCur={setCur} />
            <Button type="submit" loading={busy} disabled={amount === ''}>
              Save
            </Button>
          </Group>
        </form>
      </Stack>
    </Section>
  );
}

function BudgetBody({ b, dz }: { b: Budget; dz: Fx }) {
  const past = b.left_usd < 0;
  return (
    <Box>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" fw={600} truncate>
          {b.name}
        </Text>
        <Text size="sm" className="num" style={{ whiteSpace: 'nowrap' }}>
          <Blur inline>
            {dz.main(b.spent_usd)} of {dz.main(b.amount_usd)}
          </Blur>
        </Text>
      </Group>
      <Progress value={share(b.spent_usd, b.amount_usd)} color={past ? 'yellow' : undefined} size="sm" my={6} aria-label={b.name} />
      <Text size="xs" c="dimmed" className="num">
        <Blur inline>{past ? `${dz.both(-b.left_usd)} past the budget` : `${dz.both(b.left_usd)} left`}</Blur> · {f.range(b.from, b.to)}
      </Text>
    </Box>
  );
}

function BudgetRow({ b, dz }: { b: Budget; dz: Fx }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const usd = toUsd(amount, cur, dz);
    if (usd === null) return;
    if (await act(v2.patchBudget(b.id, { amount_usd: usd }), 'Budget saved')) {
      setEditing(false);
      emit('money');
    }
  };
  const remove = async () => {
    if (!(await act(v2.deleteBudget(b.id)))) return;
    emit('money');
    toastUndo('Budget removed', () => {
      const period = (['week', 'month', 'year'].includes(b.period) ? b.period : 'month') as 'week' | 'month' | 'year';
      void act(v2.addBudget({ name: b.name, period, amount_usd: b.amount_usd, categories: b.category_ids })).then((x) => x && emit('money'));
    });
  };
  return (
    <Stack gap={6}>
      <Group wrap="nowrap" gap="xs" align="flex-start">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <BudgetBody b={b} dz={dz} />
        </Box>
        <IconBtn icon={IconPencil} size="md" variant="subtle" color="gray" label={`Edit ${b.name}`} onClick={() => setEditing((x) => !x)} />
        <IconBtn icon={IconTrash} size="md" variant="subtle" color="gray" label={`Remove ${b.name}`} onClick={() => void remove()} />
      </Group>
      {editing && (
        <form onSubmit={save}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <AmountField label={`Amount per ${b.period}`} value={amount} onChange={setAmount} cur={cur} setCur={setCur} />
            <Button type="submit" disabled={amount === ''}>
              Save
            </Button>
          </Group>
        </form>
      )}
    </Stack>
  );
}

function AddBudget({ dz }: { dz: Fx }) {
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const [amount, setAmount] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return void toast('Name the budget');
    const usd = toUsd(amount, cur, dz);
    if (usd === null) return;
    if (await act(v2.addBudget({ name: name.trim(), period, amount_usd: usd }), 'Budget added')) {
      setName('');
      setAmount('');
      emit('money');
    }
  };
  return (
    <form onSubmit={add}>
      <Stack gap="xs">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput label="New budget" placeholder="Groceries" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} autoComplete="off" />
          <Select
            label="Per"
            data={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
            value={period}
            onChange={(v) => v && setPeriod(v as typeof period)}
            allowDeselect={false}
            w={100}
          />
        </Group>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <AmountField label="Amount" value={amount} onChange={setAmount} cur={cur} setCur={setCur} />
          <Button type="submit" variant="light" disabled={!name.trim() || amount === ''}>
            Add
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function SavingsRow({ g, dz }: { g: Savings; dz: Fx }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const [date, setDate] = useState(g.target_date ?? '');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const patch: { target_usd?: number; target_date?: string | null } = {};
    if (target !== '') {
      const usd = toUsd(target, cur, dz);
      if (usd === null) return;
      patch.target_usd = usd;
    }
    if (date !== (g.target_date ?? '')) {
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return void toast('Date as YYYY-MM-DD');
      patch.target_date = date || null;
    }
    if (!Object.keys(patch).length) return void setEditing(false);
    if (await act(v2.patchSavings(g.id, patch), 'Goal saved')) {
      setEditing(false);
      setTarget('');
      emit('money');
    }
  };
  const remove = async () => {
    if (!(await act(v2.deleteSavings(g.id)))) return;
    emit('money');
    toastUndo('Goal removed', () => {
      void act(v2.addSavings({ name: g.name, target_usd: g.target_usd, target_date: g.target_date ?? undefined, account: g.account_id ?? undefined })).then((x) => x && emit('money'));
    });
  };
  return (
    <Stack gap={6}>
      <Group wrap="nowrap" gap="xs" align="flex-start">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" fw={600} truncate>
              {g.name}
            </Text>
            <Text size="sm" className="num">
              {f.pct(g.target_usd ? g.saved_usd / g.target_usd : null)}
            </Text>
          </Group>
          <Progress value={share(g.saved_usd, g.target_usd)} size="sm" my={6} aria-label={g.name} />
          <Text size="xs" c="dimmed" className="num">
            <Blur inline>
              {dz.main(g.saved_usd)} of {dz.both(g.target_usd)}
            </Blur>
            {g.target_date && ` · by ${f.day(g.target_date)}`}
            {g.monthly_needed_usd !== null && (
              <>
                {' · '}
                <Blur inline>{dz.main(g.monthly_needed_usd)}</Blur>/month needed
              </>
            )}
          </Text>
        </Box>
        <IconBtn icon={IconPencil} size="md" variant="subtle" color="gray" label={`Edit ${g.name}`} onClick={() => setEditing((x) => !x)} />
        <IconBtn icon={IconTrash} size="md" variant="subtle" color="gray" label={`Remove ${g.name}`} onClick={() => void remove()} />
      </Group>
      {editing && (
        <form onSubmit={save}>
          <Stack gap="xs">
            <AmountField label="New target (blank = keep)" value={target} onChange={setTarget} cur={cur} setCur={setCur} />
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <TextInput label="By (YYYY-MM-DD, blank = none)" value={date} onChange={(e) => setDate(e.currentTarget.value)} style={{ flex: 1 }} autoComplete="off" />
              <Button type="submit">Save</Button>
            </Group>
          </Stack>
        </form>
      )}
    </Stack>
  );
}

function AddSavings({ dz }: { dz: Fx }) {
  const active = usePageActive();
  const accounts = useLoad(() => v2.accounts(), active, [], { key: 'money.accounts' });
  const [name, setName] = useState('');
  const [target, setTarget] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const [date, setDate] = useState('');
  const [account, setAccount] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return void toast('Name the goal');
    const usd = toUsd(target, cur, dz);
    if (usd === null) return;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return void toast('Date as YYYY-MM-DD');
    const r = await act(v2.addSavings({ name: name.trim(), target_usd: usd, target_date: date || undefined, account: account ?? undefined }), 'Goal added');
    if (r) {
      setName('');
      setTarget('');
      setDate('');
      setAccount(null);
      emit('money');
    }
  };
  return (
    <form onSubmit={add}>
      <Stack gap="xs">
        <TextInput label="New goal" placeholder="Savings fund" value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" />
        <AmountField label="Target" value={target} onChange={setTarget} cur={cur} setCur={setCur} />
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput label="By (YYYY-MM-DD)" placeholder="YYYY-MM-DD" value={date} onChange={(e) => setDate(e.currentTarget.value)} style={{ flex: 1 }} autoComplete="off" />
          <Select
            label="Kept in"
            placeholder="No account"
            data={(accounts.data ?? []).filter((a) => !a.archived).map((a) => ({ value: a.name, label: a.name }))}
            value={account}
            onChange={setAccount}
            clearable
            style={{ flex: 1 }}
          />
        </Group>
        <Hint>Money in the goal's account is kept out of living cash and runway.</Hint>
        <Group>
          <Button type="submit" variant="light" disabled={!name.trim() || target === ''}>
            Add goal
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
