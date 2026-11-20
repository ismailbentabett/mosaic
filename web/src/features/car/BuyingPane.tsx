import { Anchor, Button, Collapse, Group, Menu, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconExternalLink, IconSearch, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { useRefresh } from '../../store';
import { Async, Link, Section, Stat } from '../../ui/Page';
import { deleteLater, Hint, Meter, useHidden } from '../review/kit';
import { carApi, LISTING_LABEL, LISTING_STATUS, type Listing, type ListingStatus } from './client';
import { ListingForm } from './ListingForm';
import { changed, km, useOverview } from './shared';

/* ---------- Next car (fund + listings) ---------- */

export function BuyingPane() {
  const active = usePageActive();
  const o = useOverview(active);
  const all = useLoad(() => carApi.listings(), active, [], { key: 'car.listings' });
  useRefresh('car', () => void all.reload());
  const hidden = useHidden();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);

  const setStatus = async (l: Listing, status: ListingStatus) => {
    const r = await act(carApi.updateListing(l.id, { status }), LISTING_LABEL[status]);
    if (r !== null) changed(false);
  };
  const remove = (l: Listing) =>
    deleteLater({
      text: `${l.title} removed`,
      hide: () => hidden.hide(l.id),
      restore: () => hidden.show(l.id),
      run: () => carApi.removeListing(l.id),
      after: () => changed(false),
    });

  return (
    <Stack gap="md">
      <Async state={o} lines={2}>
        {(d) => {
          const fund = d.buying.fund;
          const cur = d.buying.currency;
          return (
            <Section title="Car fund" icon={PLACE_ICON.goals} right={<Link className="tap" to="/life/goals">Goals</Link>}>
              {fund ? (
                <Stack gap="sm">
                  <Group justify="space-between" align="baseline">
                    <Text fw={650} size="lg" className="num">
                      {f.unit(fund.current, fund.unit, 0)}
                      <Text span size="sm" c="dimmed" fw={400}>
                        {' '}
                        of {f.unit(fund.target, fund.unit, 0)}
                      </Text>
                    </Text>
                    {fund.target_date && (
                      <Text size="xs" c="dimmed">
                        by {f.day(fund.target_date)}
                      </Text>
                    )}
                  </Group>
                  <Meter value={fund.current ?? 0} max={fund.target ?? 0} label={`Car fund ${f.pct(fund.progress ?? 0)}`} />
                  {d.buying.fund_covers && (
                    <Text size="sm" className="num">
                      {d.buying.fund_covers.line}
                      {d.buying.fund_covers.pct >= 100 ? '. Enough for it today.' : '.'}
                    </Text>
                  )}
                  {fund.pace_line && <Hint>{fund.pace_line}</Hint>}
                </Stack>
              ) : (
                <Hint>No car fund goal yet. Make one in Goals and it shows here.</Hint>
              )}
              {d.buying.open > 0 && (
                <SimpleGrid cols={3} spacing="md" mt="md">
                  <Stat label="Watching" value={<span className="num">{f.num(d.buying.open)}</span>} />
                  <Stat label="Cheapest" value={<span className="num">{f.money(d.buying.cheapest, cur)}</span>} />
                  <Stat label="Middle price" value={<span className="num">{f.money(d.buying.median, cur)}</span>} />
                </SimpleGrid>
              )}
            </Section>
          );
        }}
      </Async>

      <Section
        title="Listings"
        icon={IconSearch}
        right={
          <Button size="xs" variant="light" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'Add listing'}
          </Button>
        }
      >
        <Stack gap="sm">
          <Collapse expanded={adding}>
            <ListingForm onDone={() => setAdding(false)} />
          </Collapse>
          <Async state={all} lines={3}>
            {(list) => {
              const visible = list.filter((l) => !hidden.has(l.id));
              const open = visible.filter((l) => l.status !== 'rejected' && l.status !== 'bought');
              const closed = visible.filter((l) => l.status === 'rejected' || l.status === 'bought');
              if (visible.length === 0) return <Hint>Save cars you see on listing sites: title, price, km, link. The cheapest and middle price show above.</Hint>;
              return (
                <Stack gap="sm">
                  {open.map((l) => (
                    <ListingRow key={l.id} l={l} onStatus={setStatus} onRemove={remove} />
                  ))}
                  {open.length === 0 && <Hint>Nothing open right now.</Hint>}
                  {closed.length > 0 && (
                    <>
                      <Button
                        variant="subtle"
                        color="gray"
                        size="xs"
                        onClick={() => setShowClosed((v) => !v)}
                        rightSection={showClosed ? <IconChevronUp size={14} stroke={STROKE} /> : <IconChevronDown size={14} stroke={STROKE} />}
                        aria-expanded={showClosed}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Closed ({closed.length})
                      </Button>
                      <Collapse expanded={showClosed}>
                        <Stack gap="sm">
                          {closed.map((l) => (
                            <ListingRow key={l.id} l={l} onStatus={setStatus} onRemove={remove} />
                          ))}
                        </Stack>
                      </Collapse>
                    </>
                  )}
                </Stack>
              );
            }}
          </Async>
        </Stack>
      </Section>
    </Stack>
  );
}

function ListingRow({ l, onStatus, onRemove }: { l: Listing; onStatus: (l: Listing, s: ListingStatus) => void; onRemove: (l: Listing) => void }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={600} truncate>
            {l.title}
          </Text>
          {l.url && (
            <Anchor className="tap" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${l.title}`} c="dimmed" style={{ minWidth: 44, justifyContent: 'center' }}>
              <IconExternalLink size={14} stroke={STROKE} />
            </Anchor>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {[l.price != null ? f.money(l.price, l.currency) : null, l.year, l.km != null ? km(l.km) : null, l.place, `saved ${f.day(l.day)}`].filter(Boolean).join(' · ')}
        </Text>
      </Stack>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button size="compact-sm" variant="light" color={l.status === 'rejected' ? 'gray' : undefined} rightSection={<IconChevronDown size={12} stroke={STROKE} />}>
            {LISTING_LABEL[l.status]}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {LISTING_STATUS.filter((s) => s !== l.status).map((s) => (
            <Menu.Item key={s} onClick={() => onStatus(l, s)}>
              {LISTING_LABEL[s]}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item leftSection={<IconTrash size={16} stroke={STROKE} />} onClick={() => onRemove(l)}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
