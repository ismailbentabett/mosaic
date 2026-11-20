import { Button, Collapse, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconGasStation, IconGauge, IconPencil, IconRefresh, IconTool } from '@tabler/icons-react';
import { useState } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, usePageActive } from '../../hooks';
import { toast } from '../../store';
import { Async, IconBtn, Link, Section, Stat } from '../../ui/Page';
import { Hint, Meter, useAsk } from '../review/kit';
import { CarForm } from './CarForm';
import { carApi, type CarOverview } from './client';
import { NoCarYet } from './NoCar';
import { BASE, changed, DueRow, km, LinkButton, monthLabel, Row, useOverview } from './shared';

/* ---------- Overview ---------- */

export function OverviewPane() {
  const active = usePageActive();
  const o = useOverview(active);
  return (
    <Async state={o} lines={4}>
      {(d) => (d.car ? <Overview d={d as CarOverview & { car: NonNullable<CarOverview['car']> }} /> : <NoCarYet />)}
    </Async>
  );
}

function Overview({ d }: { d: CarOverview & { car: NonNullable<CarOverview['car']> } }) {
  const c = d.car;
  const [askNode, ask] = useAsk();
  const [editing, setEditing] = useState(false);
  const cur = c.currency;
  const updateKm = () =>
    ask({
      title: 'Update km',
      label: 'Odometer now (km)',
      initial: c.km ? String(c.km) : '',
      numeric: true,
      hint: 'Read it off the dashboard. Fills with a km also count.',
      save: 'Save',
      onSave: async (v) => {
        const n = Math.round(Number(v.replace(/[\s,]/g, '')));
        if (!Number.isFinite(n) || n < 0) {
          toast('Type the km as a number');
          return false;
        }
        const r = await act(carApi.logKm(n), 'Km saved');
        if (r !== null) changed(false);
        return r !== null;
      },
    });
  const tm = d.this_month;
  const l90 = d.last_90;
  const facts = [c.year, c.fuel, c.plate].filter(Boolean).join(' · ');
  return (
    <Stack gap="md">
      <Section
        title={c.name}
        icon={PLACE_ICON.car}
        hint={facts || undefined}
        right={<IconBtn icon={IconPencil} label="Edit car" variant="subtle" onClick={() => setEditing((v) => !v)} />}
      >
        <Stack gap="md">
          <Collapse expanded={editing}>
            <CarForm
              initial={c}
              save="Save changes"
              onSave={async (b) => {
                const r = await act(carApi.updateCar(c.id, b), 'Saved');
                if (r !== null) {
                  setEditing(false);
                  changed(false);
                }
                return r !== null;
              }}
            />
          </Collapse>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <Stat label="Odometer" value={<span className="num">{km(c.km)}</span>} sub={d.km_per_month ? `${km(d.km_per_month)} a month` : undefined} />
            <Stat
              label="Fuel use"
              value={<span className="num">{d.economy?.last != null ? `${f.fixed(d.economy.last)} L` : f.DASH}</span>}
              sub={d.economy?.avg != null ? `per 100 km · avg ${f.fixed(d.economy.avg)}` : 'per 100 km, needs 2 full fills'}
            />
            <Stat label="This month" value={<span className="num">{f.money(tm?.total ?? 0, cur)}</span>} sub={tm ? `fuel ${f.money(tm.fuel, cur)}` : undefined} />
            <Stat
              label="Cost per km"
              value={<span className="num">{d.cost_per_km != null ? f.money(Math.round(d.cost_per_km * 10) / 10, cur) : f.DASH}</span>}
              sub="last 90 days"
            />
          </SimpleGrid>
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconGauge size={16} stroke={STROKE} />} onClick={updateKm}>
              Update km
            </Button>
            <Button size="xs" variant="subtle" component={LinkButton} to={`${BASE}/fuel`} leftSection={<IconGasStation size={16} stroke={STROKE} />}>
              Log fuel
            </Button>
          </Group>
        </Stack>
        {askNode}
      </Section>

      <Section title="Coming up" icon={IconTool} hint={d.due.length ? undefined : 'Nothing tracked yet'}>
        {d.due.length === 0 ? (
          <Hint>
            Log a service (oil, tyres…) or a paper with its end date and the next one shows here. <Link to={`${BASE}/service`}>Service</Link>
          </Hint>
        ) : (
          <Stack gap="sm">
            {d.due.slice(0, 8).map((x) => (
              <DueRow key={`${x.source}-${x.id}`} d={x} />
            ))}
          </Stack>
        )}
      </Section>

      <Section title="Spend" icon={PLACE_ICON.money}>
        <Stack gap="xs">
          {l90 && (
            <Text size="sm">
              Last 90 days: <span className="num">{f.money(l90.total, cur)}</span>
              <Text span size="xs" c="dimmed">
                {' '}
                (fuel {f.money(l90.fuel, cur)}, service {f.money(l90.service, cur)}, papers {f.money(l90.papers, cur)})
              </Text>
            </Text>
          )}
          {(d.monthly ?? []).length > 0 && <MonthBars months={d.monthly ?? []} currency={cur} />}
          {(tm?.skipped ?? 0) > 0 && <Hint>Some amounts are in another currency and are left out of these totals.</Hint>}
        </Stack>
      </Section>

      <Section title="Last done" icon={IconRefresh}>
        <Stack gap="sm">
          <Row
            title="Fuel"
            sub={
              d.last_fill
                ? `${f.day(d.last_fill.day)} · ${d.last_fill.litres != null ? `${f.fixed(d.last_fill.litres)} L` : ''}${d.last_fill.amount != null ? ` · ${f.money(d.last_fill.amount, d.last_fill.currency)}` : ''}`
                : 'No fill logged yet'
            }
          />
          <Row title="Service" sub={d.last_service ? `${d.last_service.title} · ${f.day(d.last_service.day)}` : 'No service logged yet'} />
        </Stack>
      </Section>
    </Stack>
  );
}

function MonthBars({ months, currency }: { months: NonNullable<CarOverview['monthly']>; currency: string }) {
  const max = Math.max(1, ...months.map((m) => m.fuel + m.service + m.papers));
  return (
    <Stack gap={6}>
      {months.map((m) => {
        const total = m.fuel + m.service + m.papers;
        return (
          <Group key={m.month} gap="sm" wrap="nowrap">
            <Text size="xs" c="dimmed" w={56} className="num">
              {monthLabel(m.month)}
            </Text>
            <div style={{ flex: 1 }}>
              <Meter value={total} max={max} label={`${monthLabel(m.month)}: ${f.money(total, currency)}`} />
            </div>
            <Text size="xs" w={96} ta="right" className="num">
              {total ? f.money(total, currency) : f.DASH}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}
