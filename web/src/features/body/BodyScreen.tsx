// Body: trends (weight, waist, body fat; sleep, steps, resting HR when logged), log and history, screen time.
import { LineChart } from '@mantine/charts';
import '@mantine/charts/styles.css';
import { ActionIcon, Button, Chip, Group, NumberInput, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { ChartText } from '../../ui/ChartText';
import { IconChartLine, IconDeviceMobile, IconPencilPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { copy } from '../../copy';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, toast, toastUndo, useRefresh } from '../../store';
import { Async, Empty, Page, Section, Stat } from '../../ui/Page';
import { v2, type Metric } from '../../v2';
import { parseNum, useDeferredDelete } from '../gym/kit';
import { RouteTabs, type TabDef } from '../../ui/RouteTabs';
import { fixedDomain, weightHeadline } from './lib';
import { ScreenTime } from './ScreenTime';

const BASE = '/life/body';
const TABS: TabDef[] = [
  { id: '', label: 'Trends', icon: IconChartLine },
  { id: 'log', label: 'Log', icon: IconPencilPlus },
  { id: 'screen', label: 'Screen time', icon: IconDeviceMobile },
];

type KindDef = { kind: string; label: string; unit: string; step: number; digits: number; color: string };
const KINDS: KindDef[] = [
  { kind: 'weight', label: 'Weight', unit: 'kg', step: 0.1, digits: 1, color: 'brand.6' },
  { kind: 'waist', label: 'Waist', unit: 'cm', step: 0.5, digits: 1, color: 'blue.6' },
  { kind: 'body_fat', label: 'Body fat', unit: '%', step: 0.1, digits: 1, color: 'grape.6' },
];
/** Logged here, shown as a small "Sleep and activity" block (no charts, no targets). */
const EXTRA_KINDS: KindDef[] = [
  { kind: 'sleep_h', label: 'Sleep', unit: 'h', step: 0.25, digits: 1, color: 'indigo.6' },
  { kind: 'steps', label: 'Steps', unit: 'steps', step: 500, digits: 0, color: 'teal.6' },
  { kind: 'resting_hr', label: 'Resting HR', unit: 'bpm', step: 1, digits: 0, color: 'red.6' },
];
const ALL_KINDS = [...KINDS, ...EXTRA_KINDS];
const kindOf = (k: string) => ALL_KINDS.find((x) => x.kind === k) ?? KINDS[0];
const val = (k: KindDef, n: number | null | undefined) => f.unit(n, k.unit, k.digits);
const oldestFirst = (rows: Metric[]) => [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));

export function BodyScreen() {
  return (
    <Page title="Body" icon={PLACE_ICON.body} back="/life" toolbar={<RouteTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<BodyTrends />} />
        <Route path="log" element={<BodyLog />} />
        <Route path="screen" element={<ScreenTime />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Page>
  );
}

// ---- Trends ----

function BodyTrends() {
  const active = usePageActive();
  const sum = useLoad(() => v2.body(), active, [], { key: 'body.summary' });
  useRefresh('body', () => void sum.reload());
  const w = KINDS[0];
  const headline = weightHeadline(sum.data?.avg_7d, sum.data?.avg_prev_7d);

  return (
    <Async state={sum} label="Loading body" lines={4}>
      {(s) => (
        <>
          <Section title="Latest weight" hint={s.last_weight ? f.day(s.last_weight.day) : undefined}>
            {s.last_weight ? (
              <Stack gap={4}>
                <Text fz="var(--app-fz-stat)" fw={600} className="num">
                  {f.kg(s.last_weight.kg)}
                </Text>
                {headline && (
                  <Text size="sm" c="dimmed" className="num">
                    {headline}
                  </Text>
                )}
              </Stack>
            ) : (
              <Empty title="No weigh-in yet.">Log one under Log. The trend smooths day-to-day swings.</Empty>
            )}
            {s.last_weight && (
              <SimpleGrid cols={{ base: 2, sm: 3 }} mt="md">
                <Stat label="Trend" value={f.kg(s.trend_kg)} />
                <Stat label="Weigh-ins" value={f.num(s.weigh_ins_21d)} sub="last 21 days" />
              </SimpleGrid>
            )}
            {s.note && (
              <Text size="sm" c="dimmed" mt="sm">
                {s.note}
              </Text>
            )}
          </Section>
          {KINDS.map((k) => (
            <KindChart key={k.kind} k={k} latest={k.kind === w.kind ? null : (s.latest[k.kind] ?? null)} />
          ))}
          <SleepActivity latest={s.latest} />
        </>
      )}
    </Async>
  );
}

/** Sleep, steps and resting heart rate: shown only once one of them has an entry. */
function SleepActivity({ latest }: { latest: Record<string, Metric> }) {
  const rows = EXTRA_KINDS.map((k) => ({ k, m: latest[k.kind] })).filter((x) => x.m);
  if (!rows.length) return null;
  return (
    <Section title="Sleep and activity" hint="latest">
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        {rows.map(({ k, m }) => (
          <Stat key={k.kind} label={k.label} value={val(k, m.value)} sub={f.day(m.day)} />
        ))}
      </SimpleGrid>
    </Section>
  );
}

function KindChart({ k, latest }: { k: KindDef; latest: Metric | null }) {
  const active = usePageActive();
  const rows = useLoad(() => v2.metrics(k.kind), active, [k.kind], { key: `body.metrics.${k.kind}` });
  useRefresh('body', () => void rows.reload());
  const data = useMemo(() => {
    // One point per day: the last entry of the day.
    const m = new Map<string, number>();
    for (const r of oldestFirst(rows.data ?? [])) m.set(r.day, r.value);
    return [...m.entries()].map(([day, value]) => ({ day: f.day(day), value }));
  }, [rows.data]);
  if (rows.data === null && !rows.error) return null;
  return (
    <Section title={k.label} hint={latest ? `${val(k, latest.value)} · ${f.day(latest.day)}` : undefined}>
      {rows.error && rows.data === null ? (
        <Text size="sm" c="dimmed">
          Could not load {k.label.toLowerCase()}.
        </Text>
      ) : data.length < 2 ? (
        <Text size="sm" c="dimmed">
          {data.length ? `One entry so far: ${val(k, data[0].value)}. The chart starts at two.` : `No ${k.label.toLowerCase()} logged yet.`}
        </Text>
      ) : (
        <LineChart
          h={160}
          data={data}
          dataKey="day"
          series={[{ name: 'value', label: k.label, color: k.color }]}
          curveType="monotone"
          tickLine="none"
          gridAxis="y"
          yAxisProps={{ domain: (k.kind === 'weight' ? fixedDomain(data.map((x) => x.value)) : null) ?? ['dataMin - 1', 'dataMax + 1'] }}
          valueFormatter={(v) => val(k, v)}
          aria-label={`${k.label}, ${f.plural(data.length, 'entry', 'entries')}`}
          role="img"
        />
      )}
      {data.length >= 2 && (
        <ChartText label={k.label} rows={data.map((x) => `${x.day}: ${val(k, x.value)}`)} />
      )}
    </Section>
  );
}

// ---- Log ----

function BodyLog() {
  const active = usePageActive();
  const [kind, setKind] = useState('weight');
  const k = kindOf(kind);
  const rows = useLoad(() => v2.metrics(kind), active, [kind], { key: `body.metrics.${kind}` });
  useRefresh('body', () => void rows.reload());
  const del = useDeferredDelete();
  const [value, setValue] = useState<string | number>('');
  const [busy, setBusy] = useState(false);

  const newest = useMemo(() => oldestFirst(rows.data ?? []).reverse(), [rows.data]);
  const chips = useMemo(() => [...new Set(newest.map((r) => r.value))].slice(0, 6), [newest]);

  const save = async (n: number) => {
    if (busy) return;
    if (!Number.isFinite(n) || n <= 0) return toast('Type a number');
    setBusy(true);
    const r = await act(v2.logMetric(k.kind, n, k.unit));
    setBusy(false);
    emit('body');
    if (!r) return;
    feel('capture');
    setValue('');
    toastUndo(`${k.label} ${val(k, n)}`, () => {
      void act(v2.deleteMetric(r.id)).then(() => emit('body'));
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(parseNum(value));
  };

  return (
    <>
      <Section title="Log">
        <Stack gap="sm">
          <SegmentedControl
            fullWidth
            value={kind}
            onChange={(v) => {
              feel('tap');
              setKind(v);
              setValue('');
            }}
            data={KINDS.map((x) => ({ value: x.kind, label: x.label }))}
          />
          <Group gap={6}>
            {EXTRA_KINDS.map((x) => (
              <Chip
                key={x.kind}
                size="xs"
                checked={kind === x.kind}
                onChange={() => {
                  feel('tap');
                  setKind(x.kind);
                  setValue('');
                }}
              >
                {x.label}
              </Chip>
            ))}
          </Group>
          <form onSubmit={submit}>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput
                style={{ flex: 1 }}
                label={`${k.label} (${k.unit})`}
                placeholder={newest[0] ? f.fixed(newest[0].value, k.digits) : undefined}
                value={value}
                onChange={setValue}
                step={k.step}
                min={0}
                decimalScale={2}
                decimalSeparator="."
                inputMode="decimal"
                className="num"
              />
              <Button type="submit" loading={busy}>
                Log
              </Button>
            </Group>
          </form>
          {chips.length > 0 && (
            <Group gap={6}>
              {chips.map((c) => (
                <Chip key={c} checked={false} size="sm" onChange={() => void save(c)} disabled={busy}>
                  <span className="num">{val(k, c)}</span>
                </Chip>
              ))}
            </Group>
          )}
        </Stack>
      </Section>

      <Section title="Recent" hint={k.label}>
        <Async state={rows} label="Loading entries" lines={3}>
          {() => {
            const shown = newest.filter((r) => !del.hidden.has(r.id)).slice(0, 10);
            return shown.length === 0 ? (
              <Empty title={`No ${k.label.toLowerCase()} logged yet.`}>{copy.empty.body}</Empty>
            ) : (
              <Stack gap={2}>
                {shown.map((r) => (
                  <Group key={r.id} justify="space-between" wrap="nowrap">
                    <Text size="sm">{f.day(r.day)}</Text>
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" className="num">
                        {f.unit(r.value, r.unit || k.unit, k.digits)}
                      </Text>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Delete ${k.label} ${f.day(r.day)}`}
                        onClick={() => del.remove(r.id, `${k.label} ${val(k, r.value)}`, () => v2.deleteMetric(r.id), 'body')}
                      >
                        <IconTrash size={16} stroke={STROKE} />
                      </ActionIcon>
                    </Group>
                  </Group>
                ))}
              </Stack>
            );
          }}
        </Async>
      </Section>
    </>
  );
}
