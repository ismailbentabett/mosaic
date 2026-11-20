import { Button, Divider, Stack } from '@mantine/core';
import { IconTemplate } from '@tabler/icons-react';
import { useState } from 'react';
import { grades, type GoalTemplate } from '../../grades';
import { useLoad, usePageActive } from '../../hooks';
import { go } from '../../router';
import { Async, Section } from '../../ui/Page';
import { GoalSheet } from './GoalSheet';
import { BASE, Row, useTree } from './shared';

/* ---------- Templates ---------- */

export function TemplatesPane() {
  const active = usePageActive();
  const tpl = useLoad(() => grades.templates(), active, [], { key: 'goal-templates' });
  const t = useTree(false);
  const [pick, setPick] = useState<GoalTemplate | null>(null);
  return (
    <Stack gap="md">
      <Section title="Templates" icon={IconTemplate} hint="These count themselves from what you already log.">
        <Async state={tpl} label="Loading templates" lines={4}>
          {(list) => (
            <Stack gap={0}>
              {list.map((x, i) => (
                <div key={x.key}>
                  {i > 0 && <Divider my={4} />}
                  <Row
                    title={x.name}
                    sub={`${x.why} ${x.auto ? `Counts from: ${x.auto.replace(':', ' → ')}.` : 'You log the value.'}${x.needs ? ` Needs: ${x.needs.replace(/_/g, ' ')}.` : ''}`}
                    right={
                      <Button size="xs" variant="light" onClick={() => setPick(x)}>
                        Use
                      </Button>
                    }
                  />
                </div>
              ))}
            </Stack>
          )}
        </Async>
      </Section>
      <GoalSheet opened={!!pick} onClose={() => setPick(null)} areas={t.data?.areas ?? []} pick={pick ?? undefined} onMade={() => go(BASE)} />
    </Stack>
  );
}
