// Money overview: free to spend, spent today, summary, runway, afford check, recurring, skipped buys,
// spend by who. Each card is one Section; none are nested.
import { BarChart, BarsList } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { Box, Button, Group, NumberInput, Select, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { ChartText } from '../../ui/ChartText';
import { IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KIND_ICON } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { life } from '../../life';
import { feel } from '../../sound';
import { toast, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { ErrorState, IconBtn, Loading, Notice, Section } from '../../ui/Page';
import { v2, type Afford, type MoneyRecord } from '../../v2';
import { moneyApi } from './api';
import { Blur } from './blur';
import { CURRENCIES, Hint, Readout, Row, toNum, useFx } from './kit';
import { daysBefore } from './recordText';
import { useDeferredDelete } from './undo';

export function Overview() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md">
      <Stack gap="md">
        <FreeToSpendCard />
        <SpentTodayCard />
        <SummaryCard />
        <RunwayCard />
        <SpendByWhoCard />
      </Stack>
      <Stack gap="md">
        <AffordCard />
        <SkippedCard />
        <RecurringCard />
      </Stack>
    </SimpleGrid>
  );
}

function FreeToSpendCard() {
  const active = usePageActive();
  const s = useLoad(() => moneyApi.freeToSpend(), active, [], { key: 'money.free' });
  useRefresh('money', () => void s.reload());
  const navigate = useNavigate();
  const d = s.data;
  const toBudgets = () => navigate('/life/money/budgets');
  return (
    <Section
      title="Free to spend this week"
      right={
        d && d.free !== null ? (
          <Button size="xs" variant="subtle" onClick={toBudgets}>
            Edit budget
          </Button>
        ) : undefined
      }
    >
      {!d && s.error && <ErrorState error={s.error} onRetry={() => void s.reload()} />}
      {!d && !s.error && <Loading label="Loading free to spend" lines={2} />}
      {d && d.free === null && (
        <Stack gap="xs" align="flex-start">
          <Hint>No weekly budget set yet.</Hint>
          <Button size="xs" variant="light" onClick={toBudgets}>
            Set a weekly budget
          </Button>
        </Stack>
      )}
      {d && d.free !== null && (
        <Stack gap="xs">
          <Readout
            rows={[
              { label: 'Free', value: f.usd(d.free_usd), sub: f.range(d.week_from, d.week_to) },
              { label: 'Used', value: f.usd(d.used_usd) },
              { label: 'Planned', value: f.usd(d.planned_usd) },
            ]}
          />
          <Text size="sm">
            <Blur inline>{d.line}</Blur>
          </Text>
          {d.planned.length > 0 && (
            <Box>
              {d.planned.map((p) => (
                <Row key={p.id} title={p.name} meta={p.due ? `due ${f.day(p.due).toLowerCase()}` : undefined} amount={f.usd(p.usd)} />
              ))}
            </Box>
          )}
          <Hint>An estimate from this week's budget, not a limit.</Hint>
        </Stack>
      )}
    </Section>
  );
}

function SpentTodayCard() {
  const active = usePageActive();
  const navigate = useNavigate();
  const today = lifeYmd();
  const from = daysBefore(today, 6);
  const week = useLoad(() => v2.records({ from, to: today, limit: 500 }), active, [from, today], { key: `money.week.${today}` });
  useRefresh('money', () => void week.reload());
  const rows: MoneyRecord[] = week.data ?? [];
  const spentOn = (d: string) => rows.reduce((s, r) => (r.kind === 'expense' && r.day === d ? s + (r.usd ?? 0) : s), 0);
  const days = Array.from({ length: 7 }, (_, i) => daysBefore(today, 6 - i));
  const chart = days.map((d) => ({ day: f.dayInitial(d), date: d, usd: Math.round(spentOn(d) * 100) / 100 }));
  const todayCount = rows.filter((r) => r.kind === 'expense' && r.day === today).length;
  const weekTotal = chart.reduce((s, c) => s + c.usd, 0);
  const dz = useFx();
  const sub = week.data
    ? [dz.sub(spentOn(today)), f.plural(todayCount, 'expense'), `${dz.main(weekTotal)} in 7 days`].filter(Boolean).join(' · ')
    : week.error
      ? 'Could not load today.'
      : 'Loading…';
  const LogIcon = KIND_ICON.expense;
  return (
    <Section
      title="Spent today"
      right={
        <Button size="xs" variant="light" leftSection={<LogIcon size={16} />} onClick={() => navigate('/life/money/records')}>
          Log expense
        </Button>
      }
    >
      <Readout rows={[{ label: 'Today', value: dz.main(spentOn(today)), sub }]} cols={1} />
      {week.error && !week.data && <ErrorState error={week.error} onRetry={() => void week.reload()} />}
      {weekTotal > 0 && (
        <Blur>
          <BarChart
            h={110}
            data={chart}
            dataKey="day"
            series={[{ name: 'usd', label: 'Spent', color: 'brand.6' }]}
            withYAxis={false}
            gridAxis="none"
            tickLine="none"
            valueFormatter={(v) => f.usd(v)}
            aria-label="Spending in the last 7 days"
            role="img"
          />
          <ChartText label="Spent per day" rows={chart.map((c) => `${c.day}: ${f.usd(c.usd)}`)} />
        </Blur>
      )}
    </Section>
  );
}

function SummaryCard() {
  const active = usePageActive();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const summary = useLoad(() => v2.summary(period), active, [period], { key: `money.summary.${period}` });
  useRefresh('money', () => void summary.reload());
  const s = summary.data;
  const top = s ? s.by_category.slice(0, 5) : [];
  const dz = useFx();
  return (
    <Section
      title="Summary"
      right={
        <SegmentedControl
          size="xs"
          value={period}
          onChange={(v) => {
            feel('tab');
            setPeriod(v as typeof period);
          }}
          data={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'year', label: 'Year' },
          ]}
          aria-label="Period"
        />
      }
    >
      {!s && summary.error && <ErrorState error={summary.error} onRetry={() => void summary.reload()} />}
      {!s && !summary.error && <Loading label="Loading summary" lines={2} />}
      {s && (
        <Stack gap="sm">
          <Readout
            rows={[
              { label: 'Spent', value: dz.main(s.spend_usd), sub: [dz.sub(s.spend_usd), f.range(s.from, s.to)].filter(Boolean).join(' · ') },
              { label: 'In', value: dz.main(s.income_usd), sub: dz.sub(s.income_usd) },
              { label: 'Net', value: (s.net_usd > 0 ? '+' : s.net_usd < 0 ? '−' : '') + dz.main(Math.abs(s.net_usd)), sub: dz.sub(s.net_usd) },
            ]}
          />
          {s.estimated_rates > 0 && <Hint>{f.plural(s.estimated_rates, 'record uses', 'records use')} an estimated exchange rate.</Hint>}
          {top.length > 0 && (
            <Blur>
              <BarsList
                data={top.map((c) => ({ name: c.name, value: c.usd }))}
                valueFormatter={(v) => f.usd(v)}
                barsLabel="Category"
                valueLabel="Spent"
                barHeight={28}
                barColor="var(--app-bar-fill)"
              />
            </Blur>
          )}
        </Stack>
      )}
    </Section>
  );
}

function RunwayCard() {
  const active = usePageActive();
  const runway = useLoad(() => v2.runway(), active, [], { key: 'money.runway' });
  useRefresh('money', () => void runway.reload());
  const rw = runway.data;
  const dz = useFx();
  const kept = rw ? [rw.goal_usd ? `${dz.main(rw.goal_usd)} saving goal` : '', rw.owed_usd ? `${dz.main(rw.owed_usd)} owed` : ''].filter(Boolean) : [];
  return (
    <Section title="Runway">
      {rw ? (
        <Stack gap="sm">
          <Readout
            rows={[
              { label: 'Living cash', value: dz.main(rw.cash_usd), sub: dz.sub(rw.cash_usd) },
              { label: 'Spend', value: `${dz.main(rw.weekly_burn_usd)}/week`, sub: `average of ${f.plural(rw.weeks_measured, 'week')}` },
              { label: 'Runway', value: rw.runway_weeks === null ? f.DASH : f.weeks(rw.runway_weeks) },
            ]}
          />
          {rw.lasts_to && (
            <Text size="sm">
              Cash lasts to about <b>{f.day(rw.lasts_to)}</b> at this pace.
            </Text>
          )}
          {kept.length > 0 && <Hint>Not counted as living cash: {kept.join(', ')}.</Hint>}
          {rw.under_8_weeks && <Notice tone="warn">Under 8 weeks of cash at this pace.</Notice>}
        </Stack>
      ) : runway.error ? (
        <ErrorState error={runway.error} onRetry={() => void runway.reload()} />
      ) : (
        <Loading label="Loading runway" lines={1} />
      )}
    </Section>
  );
}

function AffordCard() {
  const [amount, setAmount] = useState<string | number>('');
  const [cur, setCur] = useState('USD');
  const [from, setFrom] = useState<'cash' | 'car'>('cash');
  const [res, setRes] = useState<Afford | null>(null);
  const [busy, setBusy] = useState(false);
  const dz = useFx();
  const check = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(amount);
    if (!Number.isFinite(n) || n <= 0) return void toast('Amount must be a number');
    setBusy(true);
    const r = await act(v2.afford(n, cur, from === 'car' ? 'car' : undefined));
    setBusy(false);
    if (r) setRes(r);
  };
  const c = res?.car_fund;
  return (
    <Section title="Can I afford it?">
      <form onSubmit={check}>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            label="Amount"
            value={amount}
            onChange={setAmount}
            min={0}
            hideControls
            allowNegative={false}
            inputMode="decimal"
            placeholder="Amount"
            style={{ flex: 1 }}
          />
          <Select label="Currency" data={CURRENCIES} value={cur} onChange={(v) => v && setCur(v)} allowDeselect={false} w={90} />
          <Button type="submit" loading={busy} disabled={amount === ''}>
            Check
          </Button>
        </Group>
        <SegmentedControl
          mt="xs"
          size="xs"
          value={from}
          onChange={(v) => {
            setFrom(v as typeof from);
            setRes(null);
          }}
          data={[
            { value: 'cash', label: 'From living cash' },
            { value: 'car', label: 'From the car fund' },
          ]}
          aria-label="Pay from"
        />
      </form>
      {res && (
        <Stack gap="sm" mt="sm">
          <Readout
            cols={2}
            rows={[
              { label: 'Cost', value: dz.main(res.usd), sub: res.rate_estimated ? 'rate is an estimate' : dz.sub(res.usd) },
              { label: 'Living cash after', value: dz.main(res.cash_after_usd), sub: `now ${dz.main(res.cash_usd)}` },
              {
                label: 'Runway after',
                value: res.runway_after_weeks !== null ? f.weeks(res.runway_after_weeks) : f.DASH,
                sub: res.runway_weeks !== null ? `now ${f.weeks(res.runway_weeks)}` : undefined,
              },
              ...(res.weeks_of_spend !== null ? [{ label: 'Same as', value: `${f.fixed(res.weeks_of_spend, 1)} weeks`, sub: 'of spending' }] : []),
              ...(c
                ? [
                    {
                      label: c.name,
                      value: c.saved_after_usd !== undefined ? `${dz.main(c.saved_after_usd)} left in it` : `${dz.main(c.left_after_usd)} to go`,
                      sub:
                        c.monthly_needed_after_usd !== null
                          ? `${dz.main(c.monthly_needed_after_usd)} a month to stay on target`
                          : `${dz.main(c.left_after_usd)} to go`,
                    },
                  ]
                : []),
            ]}
          />
          {res.under_8_weeks_after && <Notice tone="warn">After this, runway is under 8 weeks.</Notice>}
          {res.cooling_off && <Hint>{res.cooling_off}</Hint>}
        </Stack>
      )}
    </Section>
  );
}

function RecurringCard() {
  const active = usePageActive();
  const r = useLoad(() => life.recurring(), active, [], { key: 'money.recurring' });
  useRefresh('money', () => void r.reload());
  const d = r.data;
  if (!d || !d.count) return null;
  return (
    <Section title="Recurring costs">
      <Hint>{d.message}</Hint>
      <Box mt="xs">
        {d.items.map((i) => (
          <Row key={i.name} title={i.name} meta={i.line} amount={i.monthly_usd != null ? `${f.usd(i.monthly_usd, 2)}/mo` : undefined} />
        ))}
      </Box>
    </Section>
  );
}

function SkippedCard() {
  const active = usePageActive();
  const r = useLoad(() => life.skipped(), active, [], { key: 'money.skipped' });
  useRefresh('money', () => void r.reload());
  const del = useDeferredDelete();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const d = r.data;
  const items = (d?.items ?? []).filter((i) => !del.hidden.has(i.id));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    const m = t.match(/^(.*?)\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{3})?$/);
    const name = (m ? m[1] : t).trim() || 'Something';
    const amount = m ? Number(m[2].replace(',', '.')) : undefined;
    setBusy(true);
    const x = await act(life.skip(name, amount, m?.[3]?.toUpperCase() || 'USD'), 'Kept');
    setBusy(false);
    if (x) {
      feel('capture');
      setText('');
      void r.reload();
    }
  };
  return (
    <Section title="Did not buy">
      <Stack gap="sm">
        {d && d.summary.count ? (
          <Text size="sm" c="dimmed" className="num">
            {f.plural(d.summary.count, 'skip')}, about <Blur inline>{f.usd(d.summary.total_usd, 0)}</Blur> kept.
          </Text>
        ) : (
          <Hint>Log a buy you chose not to make.</Hint>
        )}
        <form onSubmit={submit}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              label="Skipped buy"
              placeholder="Name and amount, e.g. sneakers 9000"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              autoComplete="off"
              style={{ flex: 1 }}
            />
            <Button type="submit" variant="light" loading={busy} disabled={!text.trim()}>
              Skip
            </Button>
          </Group>
        </form>
        {r.error && !d && <ErrorState error={r.error} onRetry={() => void r.reload()} />}
        {items.length > 0 && (
          <Box>
            {items.slice(0, 8).map((i) => {
              const label = i.name || 'Something';
              return (
                <Row
                  key={i.id}
                  title={label}
                  meta={f.day(i.day)}
                  amount={i.amount !== null ? f.money(i.amount, i.currency) : undefined}
                  actions={
                    <IconBtn
                      icon={IconTrash}
                      size="md"
                      variant="subtle"
                      color="gray"
                      label={`Delete ${label}`}
                      onClick={() => del.remove(i.id, label, () => moneyApi.deleteSkipped(i.id), 'money')}
                    />
                  }
                />
              );
            })}
          </Box>
        )}
      </Stack>
    </Section>
  );
}

function SpendByWhoCard() {
  const active = usePageActive();
  const r = useLoad(() => moneyApi.spendByWho(), active, [], { key: 'money.byWho' });
  useRefresh('money', () => void r.reload());
  const d = r.data;
  return (
    <Section title="Spent for whom" hint={d ? f.range(d.from, d.to) : undefined}>
      {!d && r.error && <ErrorState error={r.error} onRetry={() => void r.reload()} />}
      {!d && !r.error && <Loading label="Loading spend by who" lines={2} />}
      {d && (
        <Stack gap="xs">
          {d.by_who.length > 0 ? (
            <Blur>
              <BarsList
                data={d.by_who.map((w) => ({ name: `${w.who} · ${f.plural(w.count, 'record')}`, value: w.usd }))}
                valueFormatter={(v) => f.usd(v)}
                barsLabel="For"
                valueLabel="Spent"
                barHeight={28}
                barColor="var(--app-bar-fill)"
              />
            </Blur>
          ) : (
            <Hint>No expense is tagged yet. Tag one from Records, under Edit.</Hint>
          )}
          {d.untagged_count > 0 && (
            <Text size="sm" c="dimmed" className="num">
              <Blur inline>{f.usd(d.untagged_usd)}</Blur> untagged · {f.plural(d.untagged_count, 'record')}
            </Text>
          )}
        </Stack>
      )}
    </Section>
  );
}
