import { Button, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useState } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { type AreaGrade, type GradeFact } from '../../grades';
import { Hint, Meter } from './kit';

export function AreaRow({ area, onTarget }: { area: AreaGrade; onTarget: (fact: GradeFact) => void }) {
  const [open, setOpen] = useState(false);
  const top = [...area.facts].sort((a, b) => b.share - a.share)[0];
  return (
    <Stack gap={4}>
      <UnstyledButton className="tap-row" w="100%" onClick={() => setOpen((o) => !o)} aria-expanded={open} py={6}>
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600} lineClamp={1}>
              {area.name}
            </Text>
            {area.lift && (
              <Text size="xs" c="dimmed" lineClamp={2}>
                {area.lift}
              </Text>
            )}
          </Stack>
          <Group gap={6} wrap="nowrap">
            {top ? (
              <Text size="sm" className="num" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {f.num(top.actual, 1)} / {f.unit(top.target, top.unit)}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                nothing logged
              </Text>
            )}
            {open ? <IconChevronUp size={16} stroke={STROKE} /> : <IconChevronDown size={16} stroke={STROKE} />}
          </Group>
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Stack gap="sm" pb="sm">
          {area.facts.length === 0 ? (
            <Hint>Nothing logged here this week. No effect.</Hint>
          ) : (
            area.facts.map((fact) => (
              <Stack key={fact.key} gap={4}>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" lineClamp={1}>
                    {fact.label}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" className="num">
                      {f.num(fact.actual, 1)} / {f.unit(fact.target, fact.unit)}
                    </Text>
                    <Button size="compact-sm" variant="subtle" onClick={() => onTarget(fact)}>
                      Target
                    </Button>
                  </Group>
                </Group>
                <Meter value={Math.min(fact.actual, fact.target)} max={fact.target} label={`${fact.label}: ${f.pct(fact.share)}`} />
              </Stack>
            ))
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}
