// Accounts, transfers, the EUR rate and money lent or borrowed. Plain forms; the same actions exist
// in MCP (money_accounts, money_transfer, money_rate, money_debts). Account numbers are never stored here.
import { Box, Button, Group, NumberInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconArchive } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import type { ApiError } from '../../api';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { emit, toast, useRefresh } from '../../store';
import { ErrorState, IconBtn, Loading, Section } from '../../ui/Page';
import { lifeYmd } from '../../time';
import { v2, type Account, type Debt } from '../../v2';
import { CURRENCIES, Hint, Row, toNum } from './kit';

export function Accounts() {
  const active = usePageActive();
  const accounts = useLoad(() => v2.accounts(), active, [], { key: 'money.accounts' });
  const debts = useLoad(() => v2.debts(), active, [], { key: 'money.debts' });
  const rates = useLoad(() => v2.rates(), active, [], { key: 'money.rates' });
  useRefresh('money', () => {
    void accounts.reload();
    void debts.reload();
    void rates.reload();
  });
  const live = (accounts.data ?? []).filter((a) => !a.archived);
  const names = live.map((a) => ({ value: a.name, label: `${a.name} · ${a.currency}` }));
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
      <Stack gap="md">
        <Section title="Accounts">
          {accounts.error && !accounts.data && <ErrorState error={accounts.error} onRetry={() => void accounts.reload()} />}
          {!accounts.data && !accounts.error && <Loading label="Loading accounts" lines={2} />}
          {accounts.data && (
            <Stack gap="sm">
              {live.length === 0 ? <Hint>No account yet.</Hint> : <AccountList accounts={live} />}
              <AddAccount />
              <Hint>Names only. Account and card numbers stay in your password manager.</Hint>
            </Stack>
          )}
        </Section>
        <TransferForm names={names} />
      </Stack>
      <Stack gap="md">
        <RateForm current={(rates.data ?? []).find((r) => r.currency === 'EUR') ?? null} />
        <DebtsCard debts={debts.data ?? null} names={names} error={debts.error} reload={() => void debts.reload()} />
      </Stack>
    </SimpleGrid>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  const archive = async (a: Account) => {
    if (await act(v2.patchAccount(a.id, { archived: true }), `${a.name} archived`)) emit('money');
  };
  return (
    <Box>
      {accounts.map((a) => (
        <Row
          key={a.id}
          title={a.name}
          meta={`${a.type} · ${a.track}`}
          amount={f.money(a.balance, a.currency)}
          actions={<IconBtn icon={IconArchive} size="md" variant="subtle" color="gray" label={`Archive ${a.name}`} onClick={() => void archive(a)} />}
        />
      ))}
    </Box>
  );
}

function AddAccount() {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [type, setType] = useState('cash');
  const [opening, setOpening] = useState<string | number>('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return void toast('Name the account');
    const ob = opening === '' ? 0 : toNum(opening);
    if (!Number.isFinite(ob)) return void toast('Starting balance must be a number');
    if (await act(v2.addAccount({ name: name.trim(), currency, type, opening_balance: ob }), 'Account added')) {
      setName('');
      setOpening('');
      emit('money');
    }
  };
  return (
    <form onSubmit={add}>
      <Stack gap="xs">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput label="New account" placeholder="Wallet" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} autoComplete="off" />
          <Select label="Currency" data={CURRENCIES} value={currency} onChange={(v) => v && setCurrency(v)} allowDeselect={false} w={90} />
        </Group>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            label="Type"
            data={['cash', 'bank', 'card', 'savings', 'wallet']}
            value={type}
            onChange={(v) => v && setType(v)}
            allowDeselect={false}
            style={{ flex: 1 }}
          />
          <NumberInput label="Starting balance" value={opening} onChange={setOpening} hideControls inputMode="decimal" style={{ flex: 1 }} />
          <Button type="submit" variant="light" disabled={!name.trim()}>
            Add
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function TransferForm({ names }: { names: { value: string; label: string }[] }) {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | number>('');
  const [toAmount, setToAmount] = useState<string | number>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!from || !to) return void toast('Pick both accounts');
    if (from === to) return void toast('Pick two different accounts');
    const n = toNum(amount);
    if (!Number.isFinite(n) || n <= 0) return void toast('Amount must be a number above 0');
    const ta = toAmount === '' ? undefined : toNum(toAmount);
    if (ta !== undefined && (!Number.isFinite(ta) || ta <= 0)) return void toast('Amount received must be a number');
    setBusy(true);
    const r = await act(v2.transfer({ from, to, amount: n, to_amount: ta, note: note.trim() || undefined, day: lifeYmd() }), 'Moved');
    setBusy(false);
    if (r) {
      setAmount('');
      setToAmount('');
      setNote('');
      emit('money');
    }
  };
  return (
    <Section title="Move money between accounts">
      {names.length < 2 ? (
        <Hint>Needs two accounts.</Hint>
      ) : (
        <form onSubmit={send}>
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <Select label="From" data={names} value={from} onChange={setFrom} style={{ flex: 1 }} />
              <Select label="To" data={names} value={to} onChange={setTo} style={{ flex: 1 }} />
            </Group>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Amount (from's currency)" value={amount} onChange={setAmount} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
              <NumberInput label="Received (optional)" value={toAmount} onChange={setToAmount} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
            </Group>
            <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} autoComplete="off" />
            <Group>
              <Button type="submit" loading={busy} disabled={amount === ''}>
                Move
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Section>
  );
}

function RateForm({ current }: { current: { day: string; to_usd: number } | null }) {
  const [per, setPer] = useState<string | number>('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(per);
    if (!Number.isFinite(n) || n < 0.3 || n > 3) return void toast('EUR for 1 USD, between 0.3 and 3');
    setBusy(true);
    const r = await act(v2.setRate('EUR', 1 / n, lifeYmd()), 'Rate saved');
    setBusy(false);
    if (r) {
      setPer('');
      emit('money');
    }
  };
  const now = current && current.to_usd > 0 ? Math.round((1 / current.to_usd) * 10000) / 10000 : null;
  return (
    <Section title="EUR rate">
      <Stack gap="xs">
        <Text size="sm" className="num">
          {now ? `1 USD = ${f.num(now, 4)} EUR · set ${f.day(current!.day).toLowerCase()}` : 'No rate saved. About 0.93 EUR per USD is used, marked as an estimate.'}
        </Text>
        <form onSubmit={save}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <NumberInput label="EUR for 1 USD today" placeholder="0.92" value={per} onChange={setPer} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
            <Button type="submit" loading={busy} disabled={per === ''}>
              Save
            </Button>
          </Group>
        </form>
      </Stack>
    </Section>
  );
}

function DebtsCard({ debts, names, error, reload }: { debts: Debt[] | null; names: { value: string; label: string }[]; error: ApiError | null; reload: () => void }) {
  const open = (debts ?? []).filter((d) => !d.closed);
  return (
    <Section title="Lent and borrowed">
      {!debts && error ? <ErrorState error={error} onRetry={reload} /> : null}
      {!debts && !error && <Loading label="Loading debts" lines={2} />}
      {debts && (
        <Stack gap="sm">
          {open.length === 0 && <Hint>Nothing open.</Hint>}
          {open.map((d) => (
            <DebtRow key={d.id} d={d} names={names} />
          ))}
          <AddDebt names={names} />
        </Stack>
      )}
    </Section>
  );
}

function DebtRow({ d, names }: { d: Debt; names: { value: string; label: string }[] }) {
  const [amount, setAmount] = useState<string | number>('');
  const [account, setAccount] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const repay = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(amount);
    if (!Number.isFinite(n) || n <= 0) return void toast('Amount must be a number above 0');
    if (await act(v2.repayDebt(d.id, n, account ?? undefined), 'Repayment logged')) {
      setAmount('');
      setOpen(false);
      emit('money');
    }
  };
  return (
    <Stack gap={4}>
      <Row
        title={`${d.direction === 'lent' ? 'Lent to' : 'Borrowed from'} ${d.person}`}
        meta={d.note || `${f.money(d.repaid, d.currency)} paid back`}
        amount={`${f.money(d.left, d.currency)} left`}
        actions={
          <Button size="compact-sm" variant="subtle" onClick={() => setOpen((x) => !x)}>
            Repay
          </Button>
        }
      />
      {open && (
        <form onSubmit={repay}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <NumberInput label={`Amount (${d.currency})`} value={amount} onChange={setAmount} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
            <Select label="Account" placeholder="Same as before" data={names} value={account} onChange={setAccount} clearable style={{ flex: 1 }} />
            <Button type="submit" disabled={amount === ''}>
              Save
            </Button>
          </Group>
        </form>
      )}
    </Stack>
  );
}

function AddDebt({ names }: { names: { value: string; label: string }[] }) {
  const [person, setPerson] = useState('');
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [amount, setAmount] = useState<string | number>('');
  const [currency, setCurrency] = useState('USD');
  const [account, setAccount] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!person.trim()) return void toast('Who is it with?');
    const n = toNum(amount);
    if (!Number.isFinite(n) || n <= 0) return void toast('Amount must be a number above 0');
    const r = await act(v2.addDebt({ person: person.trim(), direction, amount: n, currency, account: account ?? undefined, record: !!account }), 'Saved');
    if (r) {
      setPerson('');
      setAmount('');
      emit('money');
    }
  };
  return (
    <form onSubmit={add}>
      <Stack gap="xs">
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            label="New"
            data={[
              { value: 'lent', label: 'I lent' },
              { value: 'borrowed', label: 'I borrowed' },
            ]}
            value={direction}
            onChange={(v) => v && setDirection(v as typeof direction)}
            allowDeselect={false}
            w={130}
          />
          <TextInput label="Person" value={person} onChange={(e) => setPerson(e.currentTarget.value)} style={{ flex: 1 }} autoComplete="off" />
        </Group>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput label="Amount" value={amount} onChange={setAmount} min={0} hideControls allowNegative={false} inputMode="decimal" style={{ flex: 1 }} />
          <Select label="Currency" data={CURRENCIES} value={currency} onChange={(v) => v && setCurrency(v)} allowDeselect={false} w={90} />
        </Group>
        <Select label="Account (optional: logs the money moving)" data={names} value={account} onChange={setAccount} clearable />
        <Group>
          <Button type="submit" variant="light" disabled={!person.trim() || amount === ''}>
            Add
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
