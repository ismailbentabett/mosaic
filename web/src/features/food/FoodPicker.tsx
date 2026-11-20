// Search the food list and log by grams, or type "kebab 600" to log an estimate.
import { Button, Group, NumberInput, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act } from '../../hooks';
import { emit, toast } from '../../store';
import { v2, type FoodEntry, type FoodItem, type Slot } from '../../v2';
import { toNum } from '../money/kit';
import { commitWrite } from '../money/undo';
import { parseEstimate, SLOT_LABEL } from './lib';

const GRAM_CHIPS = [50, 100, 150, 200, 300];

export function FoodPicker({
  slot,
  onLogged,
  inputRef,
}: {
  slot: Slot;
  onLogged: (e: FoodEntry, label: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const searchRef = inputRef ?? ownRef;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FoodItem[]>([]);
  const [pick, setPick] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState<string | number>(100);
  const [busy, setBusy] = useState(false);
  const gramsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || pick) {
      setHits([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      v2.foodSearch(t, 8)
        .then((r) => live && setHits(r))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, pick]);
  useEffect(() => {
    if (pick) gramsRef.current?.focus();
  }, [pick]);

  const reset = () => {
    setPick(null);
    setQ('');
    setGrams(100);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };
  const g = toNum(grams);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick || busy) return;
    if (!Number.isFinite(g) || g <= 0) return void toast('Grams must be a number');
    setBusy(true);
    const { r, done } = await commitWrite(v2.logFood({ slot, food: pick.id, grams: g }));
    setBusy(false);
    emit('food');
    if (r) onLogged(r, pick.name);
    if (done) reset();
  };

  const est = parseEstimate(q);
  const quick = async () => {
    if (!est) return void toast('Pick a food, or type a name and its calories, like “kebab 600”');
    if (busy) return;
    setBusy(true);
    const { r, done } = await commitWrite(v2.logFood({ slot, name: est.name, kcal: est.kcal, estimate: true }));
    setBusy(false);
    emit('food');
    if (r) onLogged(r, `${est.name} (estimate)`);
    if (done) reset();
  };

  if (pick) {
    const ok = Number.isFinite(g);
    return (
      <form onSubmit={save} aria-label={`Log ${pick.name} to ${SLOT_LABEL[slot]}`}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            {pick.name}
          </Text>
          <NumberInput
            ref={gramsRef}
            label="Grams"
            suffix=" g"
            value={grams}
            onChange={setGrams}
            min={0}
            step={10}
            inputMode="decimal"
            classNames={{ input: 'num' }}
          />
          <Text size="sm" c="dimmed" className="num" aria-live="polite">
            {f.kcal(ok ? (pick.kcal * g) / 100 : null)} · {f.grams(ok ? (pick.protein * g) / 100 : null)} protein
          </Text>
          <Group gap={6}>
            {GRAM_CHIPS.map((n) => (
              <Button key={n} size="compact-sm" variant={g === n ? 'filled' : 'default'} aria-pressed={g === n} onClick={() => setGrams(n)} className="num">
                {f.grams(n)}
              </Button>
            ))}
          </Group>
          <Group gap="xs">
            <Button type="submit" loading={busy}>
              Log
            </Button>
            <Button variant="subtle" color="gray" onClick={() => setPick(null)}>
              Back
            </Button>
          </Group>
        </Stack>
      </form>
    );
  }

  const logsEstimate = !!est && (est.explicit || !hits[0]);
  return (
    <Stack gap="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (logsEstimate) void quick();
          else if (hits[0]) setPick(hits[0]);
          else void quick();
        }}
      >
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            ref={searchRef}
            style={{ flex: 1 }}
            type="search"
            label={`Food for ${SLOT_LABEL[slot].toLowerCase()}`}
            placeholder="Search, or “tagine 600”"
            leftSection={<IconSearch size={16} stroke={STROKE} />}
            enterKeyHint="go"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          <Button type="submit" disabled={!q.trim()} loading={busy}>
            {logsEstimate ? 'Log' : 'Pick'}
          </Button>
        </Group>
      </form>
      {(est || hits.length > 0) && (
        <Stack gap={0} role="list">
          {est && <Hit title={`Log “${est.name}”`} meta={`${f.kcal(est.kcal)} · estimate`} onClick={() => void quick()} />}
          {hits.map((h) => (
            <Hit key={h.id} title={h.name} meta={`${f.kcal(h.kcal)} · ${f.grams(h.protein, 1)} protein per ${f.grams(100)}`} onClick={() => setPick(h)} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function Hit({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <UnstyledButton
      role="listitem"
      onClick={onClick}
      py={8}
      px={4}
      style={{ borderRadius: 'var(--mantine-radius-sm)', borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Text size="sm" fw={600} lineClamp={2}>
        {title}
      </Text>
      <Text size="xs" c="dimmed" className="num" truncate>
        {meta}
      </Text>
    </UnstyledButton>
  );
}

/** Adds the built-in local dishes to the food list once. */
export function SeedLocalFoods() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await act(v2.seedLocalFoods());
    setBusy(false);
    if (!r) return;
    toast(r.added ? 'Added ' + f.plural(r.added, 'local dish', 'local dishes') : 'Local dishes are already in');
    if (r.added) emit('food');
  };
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm" c="dimmed">
        Khobz, kesra, chorba, couscous and more, with bread fractions (¼, ½, 1).
      </Text>
      <Button size="compact-sm" variant="light" loading={busy} onClick={() => void run()} style={{ flexShrink: 0 }}>
        Add local dishes
      </Button>
    </Group>
  );
}
