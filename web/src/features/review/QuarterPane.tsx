import { Button, Text } from '@mantine/core';
import { IconFileText } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { grades } from '../../grades';
import { act, useLoad, usePageActive } from '../../hooks';
import { toast } from '../../store';
import { Async, Empty, Section } from '../../ui/Page';
import { Hint } from './kit';

/* ---------- Quarter ---------- */

export function QuarterPane() {
  const active = usePageActive();
  const p = useLoad(() => grades.quarterPreview(), active, [], { key: 'quarter-preview' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act(grades.quarterExport());
    setBusy(false);
    if (r) {
      toast(`Saved to vault: ${r.path} · ${f.plural(r.weeks, 'week')}, ${f.plural(r.milestones, 'milestone')}`);
      p.setData(r);
    }
  };
  return (
    <Section
      title="Quarter summary"
      icon={IconFileText}
      right={
        <Button size="compact-sm" onClick={() => void save()} loading={busy}>
          Save quarter
        </Button>
      }
    >
      <Hint>Counts by week, work done, milestones, goal moves. Saved as Markdown in the vault.</Hint>
      <Async state={p} lines={6}>
        {(q) =>
          q.content ? (
            <Text size="sm" mt="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {q.content}
            </Text>
          ) : (
            <Empty title="Nothing to summarise yet." />
          )
        }
      </Async>
    </Section>
  );
}
