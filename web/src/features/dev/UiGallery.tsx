// #/dev/ui (mock builds only): every ui/ component in every state, for eyeballing and the audit script.
import { Box, Button, Checkbox, Group, SegmentedControl, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useState } from 'react';
import { PLACE_ICON } from '../../app/icons';
import type { ApiError } from '../../api';
import { FormSheet } from '../../ui/FormSheet';
import { Async, CardsSkeleton, ChartSkeleton, Empty, ErrorState, IconBtn, Loading, Notice, Page, RowsSkeleton, Section, SectionHeader, Stat, StatSkeleton } from '../../ui/Page';
import { Row } from '../../ui/Row';
import { Sheet } from '../../ui/Sheet';

const LONG = 'A very long title that keeps going so we can see how two-line clamping and wrapping behave on a narrow phone screen';
const ERR: ApiError = { code: 'server', message: 'The API said no. Try again in a minute.' } as ApiError;
const OFFLINE: ApiError = { code: 'offline', message: 'No connection.' } as ApiError;

export function UiGallery() {
  const [dir, setDir] = useState<'ltr' | 'rtl'>('ltr');
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Page title="UI gallery" subtitle="Every shared component, every state" back="/chat">
      <SegmentedControl value={dir} onChange={(v) => setDir(v as 'ltr' | 'rtl')} data={['ltr', 'rtl']} aria-label="Direction" />
      <div dir={dir}>
        <Stack gap="md">
          <Section title="Section" hint="with hint" icon={PLACE_ICON.today} right={<IconBtn icon={PLACE_ICON.tasks} label="Action" />}>
            <SectionHeader title="SectionHeader" to="/chat" />
            <Row icon={PLACE_ICON.money} title="Row with icon and value" meta="meta line" right={<strong className="num">$12</strong>} />
            <Row title={LONG} meta={LONG} onClick={() => {}} />
            <Row lead={<Box component="label" miw={44} mih={44} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Checkbox checked={done} onChange={() => setDone(!done)} aria-label="Done" /></Box>} title="Row with checkbox" dim={done} />
          </Section>

          <Section title="Stats">
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Stat label="Cash" value="$2,480" sub="totals only" />
              <Stat label={LONG} value="123,456,789" sub={LONG} />
              <Stat label="Coloured" value="-$40" color="red" />
              <StatSkeleton />
            </SimpleGrid>
          </Section>

          <Section title="Loading">
            <Stack>
              <Loading />
              <RowsSkeleton rows={3} />
              <CardsSkeleton cards={1} />
              <ChartSkeleton h={120} />
            </Stack>
          </Section>

          <Section title="Empty, error, notice">
            <Stack>
              <Empty title="Nothing here yet" icon={PLACE_ICON.tasks} action={<Button variant="light">Add one</Button>}>
                What is missing and one way to fill it.
              </Empty>
              <ErrorState error={ERR} onRetry={() => {}} />
              <ErrorState error={OFFLINE} onRetry={() => {}} />
              <Async state={{ data: ['kept'], error: ERR, loading: false, reload: () => {} }}>{(d) => <Notice>Stale data: {d[0]}</Notice>}</Async>
              <Notice tone="warn">A warning notice.</Notice>
            </Stack>
          </Section>

          <Section title="Buttons and inputs">
            <Stack>
              <Group>
                <Button>Primary</Button>
                <Button variant="light">Light</Button>
                <Button variant="default">Default</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Loading</Button>
              </Group>
              <TextInput label="Text" placeholder="Placeholder" />
              <TextInput label="With error" error="This field needs a value" />
              <TextInput label="Disabled" disabled value="Read only" readOnly />
            </Stack>
          </Section>

          <Section title="Overlays">
            <Group>
              <Button variant="light" onClick={() => setSheet(true)}>
                Open Sheet
              </Button>
              <Button variant="light" onClick={() => setForm(true)}>
                Open FormSheet
              </Button>
            </Group>
          </Section>
        </Stack>
      </div>
      <Sheet opened={sheet} onClose={() => setSheet(false)} title="Sheet">
        {LONG}
      </Sheet>
      <FormSheet opened={form} onClose={() => setForm(false)} title="FormSheet" onSave={() => setForm(false)}>
        <TextInput label="Name" data-autofocus />
      </FormSheet>
    </Page>
  );
}
