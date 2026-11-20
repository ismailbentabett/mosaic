import { Radio, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api, asApiError, MODES, type Mode } from '../../api';
import { feel } from '../../sound';
import { toast, useStore } from '../../store';
import { modeNow } from '../../ui';
import { ErrorState, Loading, Notice } from '../../ui/Page';

export const MODE_HELP: Record<Mode, string> = {
  Normal: 'Full plan: 3 priorities and the regular blocks.',
  Zero: 'One 10-minute task. Block titles are stripped.',
  Family: 'One block at most. Capture only.',
};

/** The three modes as a radio list. Writes the Sheet cell through the API, optimistic with revert. */
export function ModeList({ onChanged }: { onChanged?: (m: Mode) => void }) {
  const { mode } = useStore(modeNow);
  const [source, setSource] = useState<'sheet' | 'cache' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .mode()
      .then((r) => {
        if (!alive) return;
        modeNow.set({ mode: r.mode });
        setSource(r.source);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [tick]);

  const change = async (next: Mode) => {
    if (next === mode || busy) return;
    const prev = mode;
    feel('tap');
    modeNow.set({ mode: next });
    setBusy(true);
    try {
      const r = await api.setMode(next);
      modeNow.set({ mode: r.mode });
      setSource('sheet');
      toast(`Mode set to ${r.mode}`);
      onChanged?.(r.mode);
    } catch (e) {
      modeNow.set({ mode: prev });
      feel('error');
      toast(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (!mode && error) return <ErrorState error={asApiError(error)} onRetry={() => setTick((t) => t + 1)} />;
  if (!mode) return <Loading label="Loading mode" lines={4} />;

  return (
    <Stack gap="sm">
      <Radio.Group value={mode} onChange={(v) => void change(v as Mode)} aria-label="Mode">
        <Stack gap="xs">
          {MODES.map((m) => (
            <Radio.Card key={m} value={m} radius="md" p="sm" disabled={busy}>
              <Stack gap={2}>
                <Text fw={600} size="sm">
                  {m}
                  {m === mode && (
                    <Text span size="xs" c="dimmed" fw={400}>
                      {'  '}Current
                    </Text>
                  )}
                </Text>
                <Text size="xs" c="dimmed">
                  {MODE_HELP[m]}
                </Text>
              </Stack>
            </Radio.Card>
          ))}
        </Stack>
      </Radio.Group>
      {source === 'cache' && <Notice tone="warn">Showing the cached mode. The Sheet could not be read just now.</Notice>}
    </Stack>
  );
}
