import { Box, Button, Group, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { useState } from 'react';
import { api, asApiError, type Conflict, type ConflictAction } from '../../../api';
import { feel } from '../../../sound';
import { usePageActive } from '../../../hooks';
import { emit, toast } from '../../../store';
import { useLoad } from '../../../ui/data';
import { Empty, ErrorState, Loading, Page, Section } from '../../../ui/Page';
import { Compare } from './Compare';
import { NOTES } from './paths';

// ---------- conflicts ----------

function ConflictItem({ c, onDone }: { c: Conflict; onDone: () => void }) {
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = async (action: ConflictAction) => {
    setBusy(true);
    try {
      await api.resolveConflict(c.conflict, action, action === 'merge' ? merged : undefined);
      feel('tap');
      toast(action === 'keep_original' ? 'Kept the original' : action === 'keep_conflict' ? 'Kept the conflict copy' : 'Merged and saved');
      emit('notes');
      onDone();
    } catch (e) {
      toast(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="section" aria-label={`Conflict for ${c.original}`}>
      <Section title={c.original}>
        {!merging ? (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap="xs">
                <Text fw={600} size="sm" component="h4" m={0}>
                  Original
                </Text>
                <Compare text={c.originalContent} />
                <Button variant="default" disabled={busy} onClick={() => void resolve('keep_original')}>
                  Keep original
                </Button>
              </Stack>
              <Stack gap="xs">
                <Box>
                  <Text fw={600} size="sm" component="h4" m={0}>
                    Conflict copy
                  </Text>
                  <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                    {c.conflict.split('/').pop()}
                  </Text>
                </Box>
                <Compare text={c.conflictContent} />
                <Button variant="default" disabled={busy} onClick={() => void resolve('keep_conflict')}>
                  Keep conflict
                </Button>
              </Stack>
            </SimpleGrid>
            <Group justify="flex-end">
              <Button
                onClick={() => {
                  setMerged(`${c.originalContent.trimEnd()}\n\n${c.conflictContent.trimEnd()}\n`);
                  setMerging(true);
                }}
              >
                Merge both
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="sm">
            <Textarea
              data-draft
              label="Edit the merged text, then save. Both copies are replaced by this."
              autosize
              minRows={8}
              value={merged}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 'var(--mantine-font-size-sm)' } }}
              onChange={(e) => setMerged(e.currentTarget.value)}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" color="gray" onClick={() => setMerging(false)}>
                Back
              </Button>
              <Button disabled={busy || !merged.trim()} onClick={() => void resolve('merge')}>
                Save merge
              </Button>
            </Group>
          </Stack>
        )}
      </Section>
    </Box>
  );
}

export function Conflicts() {
  const active = usePageActive();
  const list = useLoad<Conflict[]>(() => api.conflicts().then((r) => r.conflicts), active);
  return (
    <Page title="Sync conflicts" back={NOTES}>
      <Text size="sm" c="dimmed">
        Syncthing saved two versions of these notes. Choose one, or merge them by hand.
      </Text>
      {!list.data ? (
        list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <Loading label="Loading conflicts" lines={6} />
      ) : list.data.length === 0 ? (
        <Empty title="No conflicts left.">Next action: go back to your notes.</Empty>
      ) : (
        list.data.map((c) => <ConflictItem key={c.conflict} c={c} onDone={() => void list.reload()} />)
      )}
    </Page>
  );
}
