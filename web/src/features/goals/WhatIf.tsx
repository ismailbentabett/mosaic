import { Button, Slider, Stack, Text } from '@mantine/core';
import { IconCalculator } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import * as f from '../../fmt';
import { grades, type WhatIf } from '../../grades';
import { go } from '../../router';
import { Async, Empty, Section } from '../../ui/Page';
import { Hint } from '../review/kit';
import { BASE, goalsOf, isSavings, useTree } from './shared';

/* ---------- What if ---------- */

export function WhatIfSlider({ id }: { id: string }) {
  const [perWeek, setPerWeek] = useState(50);
  const [r, setR] = useState<WhatIf | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      grades.whatIf(id, perWeek)
        .then((x) => {
          if (live) {
            setR(x);
            setErr('');
          }
        })
        .catch((e: Error) => {
          if (live) setErr(e.message);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [id, perWeek]);
  const cap = r?.max_per_week_usd ?? 0;
  const max = Math.max(500, cap);
  return (
    <Stack gap={6}>
      <Text size="sm" fw={600} className="num">
        What if I save {f.usd(perWeek, 0)} a week?
      </Text>
      <Slider
        min={0}
        max={max}
        step={5}
        value={perWeek}
        onChange={setPerWeek}
        label={(v) => f.usd(v, 0)}
        aria-label="USD saved per week"
      />
      {err && <Hint>{err}</Hint>}
      {r && (
        <Text size="xs" c="dimmed" className="num">
          {r.eta ? `Reached around ${f.day(r.eta)}` : 'No end date at this rate'}
          {r.on_time === true && ' · before the date'}
          {r.on_time === false && ' · after the date'}
          {` · about ${f.usd(r.per_week_usd, 0)}/week${r.rate_estimated ? ' (rate estimated)' : ''}`}
          {r.runway_months_after !== null && ` · runway after: ${f.num(r.runway_months_after, 1)} months`}
          {r.capped && ` · capped to keep ${f.num(r.cash_floor_months)} months of cash`}
        </Text>
      )}
    </Stack>
  );
}

export function WhatIfPane() {
  const t = useTree(false);
  return (
    <Async state={t} label="Loading goals" lines={3}>
      {(d) => {
        const list = goalsOf(d).filter(isSavings);
        if (list.length === 0) {
          return (
            <Section title="What if" icon={IconCalculator}>
              <Empty title="No savings goal yet." action={<Button variant="light" onClick={() => go(`${BASE}/templates`)}>Savings fund template</Button>}>
                The what-if works on goals that count themselves from savings.
              </Empty>
            </Section>
          );
        }
        return (
          <Stack gap="md">
            {list.map((g) => (
              <Section key={g.id} title={g.name} icon={IconCalculator} hint={g.pace_line || undefined}>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" className="num">
                    {g.current !== null ? f.unit(g.current, g.unit) : 'No value yet'}
                    {g.target_value !== null && ` of ${f.unit(g.target_value, g.unit)}`}
                    {g.target_date && ` · by ${f.day(g.target_date)}`}
                  </Text>
                  <WhatIfSlider id={g.id} />
                </Stack>
              </Section>
            ))}
            <Hint>A look only. Nothing is saved or moved.</Hint>
          </Stack>
        );
      }}
    </Async>
  );
}
