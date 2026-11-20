// Today: calories and macros ring, water, and each meal with its entries and an inline picker.
import { Box, Button, Center, Group, RingProgress, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconDroplet, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { feel } from '../../sound';
import { emit, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { ErrorState, IconBtn, Loading, Section, Stat } from '../../ui/Page';
import { EXTRA_SLOTS, SLOTS, v2, type DayStatus, type FoodDay, type Slot } from '../../v2';
import { useDeferredDelete } from '../money/undo';
import { FoodPicker } from './FoodPicker';
import { EMPTY_SLOT, kcalLeftLine, logAgain, maintenanceLine, recentList, SLOT_LABEL, slotNow, useLogged } from './lib';

/** Today's food day, shared by the tabs (same cache key). */
export function useFoodDay() {
  const active = usePageActive();
  const today = lifeYmd();
  const day = useLoad(() => v2.foodDay(), active, [today], { key: `track.food.${today}` });
  useRefresh('food', () => void day.reload());
  return day;
}

export function Today() {
  const day = useFoodDay();
  const del = useDeferredDelete();
  const { logged, tick } = useLogged();
  const [open, setOpen] = useState<Slot | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const d = day.data;

  const openSlot = (s: Slot) => {
    setOpen(s);
    window.setTimeout(() => {
      document.getElementById(`food-${s}`)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      searchRef.current?.focus();
    }, 50);
  };
  const water = async (ml: number) => {
    const r = await act(v2.water(ml));
    emit('food');
    if (!r) return;
    feel('tap');
    day.setData((x) => (x ? { ...x, water_ml: r.water_ml } : x));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const again = useMemo(() => recentList(d, 6), [d, tick]);

  if (day.error && !d) return <ErrorState error={day.error} onRetry={() => void day.reload()} />;
  if (!d) return <Loading label="Loading food" lines={4} />;
  const t = d.target;
  // Everyday slots always; night snacks show once they hold food.
  const slots = [...SLOTS, ...EXTRA_SLOTS.filter((x) => d.slots[x]?.entries.length)];
  const meals = slots.filter((s) => (d.slots[s]?.entries ?? []).some((e) => !del.hidden.has(e.id))).length;
  const now = slotNow();

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
        <Section
          title="Today"
          right={
            <Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} stroke={STROKE} />} onClick={() => openSlot(now)}>
              Log food
            </Button>
          }
        >
          <Group gap="md" wrap="nowrap" align="center">
            <MacroRing d={d} />
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <Stat label="Meals logged today" value={f.num(meals)} sub={`${f.kcal(d.total.kcal)}${t ? ` of ${f.num(t.kcal)}` : ''} · ${f.grams(d.total.protein)} protein`} />
              <Legend />
            </Stack>
          </Group>
        </Section>

        <Section title="Numbers">
          <Stack gap="sm">
            <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
              <Stat
                label="Calories"
                value={f.kcal(d.total.kcal)}
                sub={t ? [`of ${f.num(t.kcal)}`, kcalLeftLine(d.left?.kcal)].filter(Boolean).join(' · ') : undefined}
              />
              <Stat
                label="Protein"
                value={f.grams(d.total.protein)}
                sub={t && d.left ? `of ${f.grams(t.protein)}${d.left.protein > 0 ? ` · ${f.grams(d.left.protein)} to go` : ' · reached'}` : undefined}
              />
              <Stat label="Carbs · fat" value={`${f.grams(d.total.carbs)} · ${f.grams(d.total.fat)}`} />
              <Stat label="Water" value={f.ml(d.water_ml)} />
            </SimpleGrid>
            <Group gap="xs">
              {[250, 500].map((n) => (
                <Button
                  key={n}
                  size="compact-sm"
                  variant="default"
                  leftSection={<IconDroplet size={14} stroke={STROKE} />}
                  onClick={() => void water(n)}
                  className="num"
                >
                  Add {f.ml(n)} water
                </Button>
              ))}
            </Group>
            {d.estimates > 0 && (
              <Text size="sm" c="dimmed">
                {f.plural(d.estimates, 'entry is an estimate', 'entries are estimates')}.
              </Text>
            )}
            {!t && (
              <Text size="sm" c="dimmed">
                No calorie target yet. The app asks for what it needs.
              </Text>
            )}
            <DayStatusPicker d={d} onChange={(status) => day.setData((x) => (x ? { ...x, status } : x))} />
            <Maintenance day={d.day} />
          </Stack>
        </Section>
      </SimpleGrid>

      {again.length > 0 && (
        <Group gap={6} aria-label="Log again">
          <Text size="xs" c="dimmed" mr={4}>
            Log again
          </Text>
          {again.map((r) => (
            <Button
              key={r.name}
              size="compact-sm"
              variant="default"
              aria-label={`Log ${r.name} again, ${f.kcal(r.kcal)}, to ${SLOT_LABEL[now].toLowerCase()}`}
              onClick={() => void logAgain(r, slotNow(), logged)}
            >
              {r.name}
            </Button>
          ))}
        </Group>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" verticalSpacing="md" style={{ alignItems: 'start' }}>
        {slots.map((s) => {
          const slot = d.slots[s] ?? EMPTY_SLOT;
          const entries = slot.entries.filter((e) => !del.hidden.has(e.id));
          return (
            <Section
              key={s}
              id={`food-${s}`}
              title={SLOT_LABEL[s]}
              right={
                <Group gap="xs" wrap="nowrap">
                  {entries.length > 0 && (
                    <Text size="xs" c="dimmed" className="num">
                      {f.kcal(entries.reduce((a, e) => a + e.kcal, 0))}
                    </Text>
                  )}
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    aria-expanded={open === s}
                    aria-label={`${open === s ? 'Close' : 'Add to'} ${SLOT_LABEL[s]}`}
                    onClick={() => (open === s ? setOpen(null) : openSlot(s))}
                  >
                    {open === s ? 'Close' : 'Add'}
                  </Button>
                </Group>
              }
            >
              <Stack gap="sm">
                {entries.length === 0 && open !== s && (
                  <Text size="sm" c="dimmed">
                    {f.DASH}
                  </Text>
                )}
                {entries.length > 0 && (
                  <Box>
                    {entries.map((e) => (
                      <Group key={e.id} justify="space-between" wrap="nowrap" gap="sm" py={6}>
                        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                          <Text size="sm" fw={600} lineClamp={2}>
                            {e.name}
                          </Text>
                          <Text size="xs" c="dimmed" className="num" truncate>
                            {[e.grams ? f.grams(e.grams) : null, e.estimate && !e.protein ? null : `${f.grams(e.protein)} protein`, e.estimate ? 'estimate' : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </Stack>
                        <Text size="sm" fw={600} className="num" style={{ whiteSpace: 'nowrap' }}>
                          {f.kcal(e.kcal)}
                        </Text>
                        <IconBtn
                          icon={IconTrash}
                          size="md"
                          variant="subtle"
                          color="gray"
                          label={`Delete ${e.name} from ${SLOT_LABEL[s]}`}
                          onClick={() => del.remove(e.id, e.name, () => v2.deleteLog(e.id), 'food')}
                        />
                      </Group>
                    ))}
                  </Box>
                )}
                {open === s && <FoodPicker slot={s} onLogged={logged} inputRef={searchRef} />}
              </Stack>
            </Section>
          );
        })}
      </SimpleGrid>

      {d.note && (
        <Text size="sm" c="dimmed">
          {d.note}
        </Text>
      )}
    </Stack>
  );
}

const MACRO = [
  { key: 'protein', label: 'Protein', color: 'blue', perG: 4 },
  { key: 'carbs', label: 'Carbs', color: 'teal', perG: 4 },
  { key: 'fat', label: 'Fat', color: 'orange', perG: 9 },
] as const;

/** Calories from protein, carbs and fat as a ring; the full ring is the target (or today's total with no target). */
function MacroRing({ d }: { d: FoodDay }) {
  const parts = MACRO.map((m) => ({ ...m, kcal: d.total[m.key] * m.perG }));
  const sum = parts.reduce((a, p) => a + p.kcal, 0);
  const whole = Math.max(d.target?.kcal ?? 0, d.total.kcal, sum, 1);
  let room = 100;
  const sections = parts.map((p) => {
    const v = Math.min(room, (p.kcal / whole) * 100);
    room -= v;
    return { value: v, color: p.color, tooltip: `${p.label} · ${f.kcal(p.kcal)}` };
  });
  return (
    <RingProgress
      size={128}
      thickness={12}
      roundCaps
      sections={sections}
      aria-label={`${f.kcal(d.total.kcal)}${d.target ? ` of ${f.kcal(d.target.kcal)}` : ''}`}
      label={
        <Center>
          <Stack gap={0} align="center">
            <Text fw={650} size="lg" className="num">
              {f.num(d.total.kcal)}
            </Text>
            <Text size="xs" c="dimmed" className="num">
              {d.target ? `of ${f.num(d.target.kcal)}` : 'kcal'}
            </Text>
          </Stack>
        </Center>
      }
    />
  );
}

const STATUS: { value: DayStatus; label: string }[] = [
  { value: 'complete', label: 'Complete' },
  { value: 'partial', label: 'Partial' },
];

/** How complete this day's log is. Only complete days feed the maintenance estimate. Tap again to clear. */
function DayStatusPicker({ d, onChange }: { d: FoodDay; onChange: (s: DayStatus | null) => void }) {
  const cur = (d.status as DayStatus | null) ?? null;
  const pick = async (s: DayStatus) => {
    const r = await act(v2.dayStatus(cur === s ? null : s, d.day));
    if (!r) return;
    feel('tap');
    onChange(r.status);
    emit('food');
  };
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed" id="food-day-status">
        Today's log is
      </Text>
      <Group gap={6} role="group" aria-labelledby="food-day-status">
        {STATUS.map((o) => (
          <Button key={o.value} size="compact-sm" variant={cur === o.value ? 'filled' : 'default'} aria-pressed={cur === o.value} onClick={() => void pick(o.value)}>
            {o.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}

/** Maintenance from the adaptive estimate (last 21 days, complete days only). */
function Maintenance({ day }: { day: string }) {
  const active = usePageActive();
  const t = useLoad(() => v2.foodTdee(), active, [day]);
  useRefresh('food', () => void t.reload());
  const line = maintenanceLine(t.data);
  if (!line) return null;
  return (
    <Text size="sm" c="dimmed">
      {line} Estimate, not medical advice.
    </Text>
  );
}

function Legend() {
  return (
    <Group gap="sm">
      {MACRO.map((m) => (
        <Group key={m.key} gap={4} wrap="nowrap">
          <Box w={8} h={8} style={{ borderRadius: 4, background: `var(--mantine-color-${m.color}-filled)` }} />
          <Text size="xs" c="dimmed">
            {m.label}
          </Text>
        </Group>
      ))}
    </Group>
  );
}

