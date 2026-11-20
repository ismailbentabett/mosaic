// Home: the habitat today (free to spend, usual buys, experiment, people, helped, capsules, lent),
// the last-done board, and recently removed items with restore. Estimates are labelled as estimates.
import { ActionIcon, Badge, Button, Chip, Collapse, Group, Menu, NumberInput, Stack, Text, Textarea, TextInput } from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowsExchange,
  IconBulb,
  IconChevronDown,
  IconChevronUp,
  IconClockCheck,
  IconDots,
  IconFlask,
  IconLifebuoy,
  IconMailbox,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PLACE_ICON, STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { life, type Capsule, type HabitatToday, type Lent, type Removed } from '../../life';
import { emit, toast } from '../../store';
import { Async, Empty, IconBtn, Link, Page, Section } from '../../ui/Page';
import { PeopleLines } from '../people/Lines';
import { deleteLater, Hint, LineForm, Meter, SubTabs, useAsk, useHidden, whenText, type TabDef } from '../review/kit';
import { homeX, type ExperimentX, type LastDoneX } from './client';

const BASE = '/life/home';
const TABS: TabDef[] = [
  { id: 'habitat', label: 'Today', icon: PLACE_ICON.home },
  { id: 'done', label: 'Last done', icon: IconClockCheck },
  { id: 'removed', label: 'Removed', icon: IconArrowBackUp },
];

export function HomeScreen() {
  return (
    <Page title="Home" icon={PLACE_ICON.home} back="/life" toolbar={<SubTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<HabitatPane />} />
        <Route path="habitat" element={<HabitatPane />} />
        <Route path="done" element={<LastDonePane />} />
        <Route path="removed" element={<RemovedPane />} />
        <Route path="*" element={<HabitatPane />} />
      </Routes>
    </Page>
  );
}

/* ---------- Habitat today ---------- */

function HabitatPane() {
  const active = usePageActive();
  const h = useLoad(() => life.habitat(), active, [], { key: 'home.habitat' });
  return (
    <Stack gap="md">
      <Async state={h} lines={3}>
        {(d) => <ThisWeek d={d} />}
      </Async>
      <ExperimentSection active={active} onChanged={() => void h.reload()} />
      <PeopleLines active={active} />
      <HelpedSection active={active} />
      <CapsuleSection active={active} />
      <LentSection active={active} onChanged={() => void h.reload()} />
    </Stack>
  );
}

function ThisWeek({ d }: { d: HabitatToday }) {
  const ft = d.free_to_spend;
  return (
    <Section title="This week" icon={PLACE_ICON.home} hint={d.rest_day ? 'Rest day' : undefined}>
      <Stack gap="sm">
        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            Free to spend this week
          </Text>
          {ft.free === null ? (
            <Text size="sm">
              {ft.reason ? `Not known: ${ft.reason}.` : 'Not known yet.'} <Link to="/life/money">Money</Link>
            </Text>
          ) : (
            <Text fw={650} size="lg">
              <span className="num">{f.money(Math.round(ft.free), ft.currency ?? 'USD')}</span>
              {ft.estimate && (
                <Text span size="sm" c="dimmed" fw={400}>
                  {' '}
                  (estimate)
                </Text>
              )}
            </Text>
          )}
          {ft.line && <Hint>{ft.line}</Hint>}
        </Stack>

        {d.usual_buys.length > 0 && (
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              Usual buys coming up
            </Text>
            {d.usual_buys.map((b) => (
              <Group key={b.name} justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm">{b.name}</Text>
                <Text size="xs" c="dimmed">
                  {b.line ?? whenText(b.days_until)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}

        <Group gap="md">
          {d.lent_open.count > 0 && (
            <Text size="sm">
              <span className="num">{f.plural(d.lent_open.lent, 'thing')}</span> lent out,{' '}
              <span className="num">{f.num(d.lent_open.borrowed)}</span> borrowed
            </Text>
          )}
          <Link className="tap" to={`${BASE}/done`}>{d.last_done_count > 0 ? `${f.plural(d.last_done_count, 'chore')} on the board` : 'Last-done board'}</Link>
        </Group>
      </Stack>
    </Section>
  );
}

/* ---------- Tiny experiment ---------- */

function ExperimentSection({ active, onChanged }: { active: boolean; onChanged: () => void }) {
  const ex = useLoad(() => homeX.experiments(), active, [], { key: 'home.experiments' });
  const [askNode, ask] = useAsk();
  const [showPast, setShowPast] = useState(false);
  const changed = () => {
    void ex.reload();
    onChanged();
  };
  const end = (e: ExperimentX) =>
    ask({
      title: `End: ${e.name}`,
      label: 'What did you notice?',
      placeholder: 'One line, optional',
      allowEmpty: true,
      save: 'End',
      onSave: async (note) => {
        const r = await act(life.endExperiment(e.id, note), 'Ended');
        if (r !== null) changed();
        return r !== null;
      },
    });

  return (
    <Async state={ex} lines={2}>
      {(d) => {
        const run = d.running;
        const past = d.all.filter((e) => e.status !== 'running');
        return (
          <Section title="Tiny experiment" icon={IconFlask}>
            <Stack gap="sm">
              {run ? (
                <Stack gap={6}>
                  <Text size="sm" fw={600}>
                    {run.line ?? run.name}
                  </Text>
                  {run.hypothesis && <Hint>{run.hypothesis}</Hint>}
                  <Meter value={run.day_n} max={run.length_days} label={`Day ${run.day_n} of ${run.length_days}`} />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed" className="num">
                      {f.range(run.start_day, run.end_day)}
                    </Text>
                    <Button size="xs" variant="light" onClick={() => end(run)}>
                      End with a note
                    </Button>
                  </Group>
                  {run.past_end && <Hint>Its end day has passed. End it whenever you like.</Hint>}
                </Stack>
              ) : (
                <StartExperiment onDone={changed} />
              )}
              {past.length > 0 && (
                <>
                  <Button
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={() => setShowPast((v) => !v)}
                    rightSection={showPast ? <IconChevronUp size={14} stroke={STROKE} /> : <IconChevronDown size={14} stroke={STROKE} />}
                    aria-expanded={showPast}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Past experiments ({past.length})
                  </Button>
                  <Collapse expanded={showPast}>
                    <Stack gap={6}>
                      {past.map((e) => (
                        <Stack key={e.id} gap={0}>
                          <Group justify="space-between" wrap="nowrap" gap="xs">
                            <Text size="sm">{e.name}</Text>
                            <Text size="xs" c="dimmed" className="num">
                              {f.range(e.start_day, e.end_day)}
                            </Text>
                          </Group>
                          {e.outcome_note && <Hint>{e.outcome_note}</Hint>}
                        </Stack>
                      ))}
                    </Stack>
                  </Collapse>
                </>
              )}
            </Stack>
            {askNode}
          </Section>
        );
      }}
    </Async>
  );
}

function StartExperiment({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [hyp, setHyp] = useState('');
  const [days, setDays] = useState<number | string>(14);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(days));
    if (!name.trim()) return;
    if (!Number.isFinite(n) || n < 1 || n > 60) return void toast('Pick 1 to 60 days');
    setBusy(true);
    const r = await act(homeX.startExperiment({ name: name.trim(), hypothesis: hyp.trim() || undefined, days: n }), 'Started');
    setBusy(false);
    if (r) {
      setName('');
      setHyp('');
      onDone();
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          One small change for a few days, then a note. No score.
        </Text>
        <TextInput aria-label="Experiment" placeholder="Phone outside the room at night" value={name} maxLength={100} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput aria-label="What you expect" placeholder="I expect… (optional)" value={hyp} maxLength={300} onChange={(e) => setHyp(e.currentTarget.value)} />
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <NumberInput aria-label="Days" w={90} min={1} max={60} value={days} onChange={setDays} suffix=" days" hideControls />
          <Button type="submit" variant="light" loading={busy} disabled={!name.trim()}>
            Start
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/* ---------- What helped ---------- */

function HelpedSection({ active }: { active: boolean }) {
  const top = useLoad(() => life.helpedTop(), active, [], { key: 'home.helped.top' });
  const [situation, setSituation] = useState('');
  const [thing, setThing] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!situation.trim() || !thing.trim()) return;
    setBusy(true);
    const r = await act(life.addHelped(situation.trim(), thing.trim()), 'Saved');
    setBusy(false);
    if (r !== null) {
      setSituation('');
      setThing('');
      void top.reload();
    }
  };
  return (
    <Section title="What helped" icon={IconLifebuoy} right={<Link className="tap" to="/life/people/lent">All</Link>}>
      <Stack gap="sm">
        <Async state={top} lines={2}>
          {(list) =>
            list.length === 0 ? (
              <Hint>Nothing saved yet. When something gets you unstuck, note it here.</Hint>
            ) : (
              <Group gap={6}>
                {list.slice(0, 8).map((x) => (
                  <Badge key={x.thing} variant="light" color="gray" tt="none">
                    {x.thing} <span className="num">×{f.num(x.times)}</span>
                  </Badge>
                ))}
              </Group>
            )
          }
        </Async>
        <form onSubmit={(e) => void submit(e)}>
          <Stack gap="xs">
            <TextInput aria-label="Situation" placeholder="When… (stuck, tired, after a bad call)" value={situation} maxLength={120} onChange={(e) => setSituation(e.currentTarget.value)} />
            <Group gap="xs" wrap="nowrap">
              <TextInput aria-label="What helped" placeholder="…this helped" value={thing} maxLength={120} onChange={(e) => setThing(e.currentTarget.value)} style={{ flex: 1, minWidth: 0 }} />
              <Button type="submit" variant="light" loading={busy} disabled={!situation.trim() || !thing.trim()}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Section>
  );
}

/* ---------- Time capsule ---------- */

const CAPSULE_DAYS = [30, 90, 180, 365];

function CapsuleSection({ active }: { active: boolean }) {
  const caps = useLoad(() => life.capsules(), active, [], { key: 'home.capsules' });
  const [body, setBody] = useState('');
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const write = async () => {
    if (!body.trim()) return;
    setBusy(true);
    const r = await act(life.writeCapsule(body.trim(), days));
    setBusy(false);
    if (r) {
      toast(`Opens in ${f.plural(days, 'day')}`);
      setBody('');
      void caps.reload();
    }
  };
  return (
    <Section title="Note to future you" icon={IconMailbox} right={<Link className="tap" to="/life/people/capsules">All</Link>}>
      <Stack gap="sm">
        <Textarea aria-label="Note to future you" placeholder="What you want to remember, or ask yourself later" autosize minRows={2} maxLength={4000} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Chip.Group value={String(days)} onChange={(v) => setDays(Number(v))}>
            <Group gap={4}>
              {CAPSULE_DAYS.map((n) => (
                <Chip key={n} value={String(n)} size="xs">
                  {n} d
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <Button size="xs" variant="light" onClick={() => void write()} loading={busy} disabled={!body.trim()}>
            Seal
          </Button>
        </Group>
        <Async state={caps} lines={1}>
          {(list: Capsule[]) => {
            const sealed = list.filter((c) => !c.opened_at);
            return sealed.length === 0 ? null : (
              <Hint>
                <span className="num">{f.plural(sealed.length, 'note')}</span> sealed. Next opens {f.day(sealed.map((c) => c.open_on).sort()[0])}.
              </Hint>
            );
          }}
        </Async>
      </Stack>
    </Section>
  );
}

/* ---------- Lent and borrowed ---------- */

function LentSection({ active, onChanged }: { active: boolean; onChanged: () => void }) {
  const lent = useLoad(() => life.lent(), active, [], { key: 'home.lent' });
  const hidden = useHidden();
  const back = async (l: Lent) => {
    hidden.hide(l.id);
    const r = await act(life.returnLent(l.id), 'Back home');
    if (r === null) hidden.show(l.id);
    else {
      void lent.reload();
      onChanged();
    }
  };
  return (
    <Async state={lent} lines={1}>
      {(list) => {
        const rows = list.filter((l) => !hidden.has(l.id));
        if (rows.length === 0) return null;
        return (
          <Section title="Lent and borrowed" icon={IconArrowsExchange} right={<Link className="tap" to="/life/people/lent">Add</Link>}>
            <Stack gap={4}>
              {rows.map((l) => (
                <Group key={l.id} justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" lineClamp={1} style={{ minWidth: 0, flex: 1 }}>
                    {l.thing}{' '}
                    <Text span c="dimmed" size="xs">
                      {l.direction === 'lent' ? 'with' : 'from'} {l.person} · <span className="num">{f.day(l.since)}</span>
                      {l.back_by ? (
                        <>
                          {' '}
                          · back by <span className="num">{f.day(l.back_by)}</span>
                        </>
                      ) : null}
                    </Text>
                  </Text>
                  <Button size="xs" variant="light" onClick={() => void back(l)}>
                    Back
                  </Button>
                </Group>
              ))}
            </Stack>
          </Section>
        );
      }}
    </Async>
  );
}

/* ---------- Last done ---------- */

const sinceText = (r: LastDoneX) =>
  r.days_since === null ? (r.line ?? 'not yet') : r.days_since === 0 ? 'today' : r.days_since === 1 ? 'yesterday' : `${r.days_since} days ago`;

function LastDonePane() {
  const active = usePageActive();
  const board = useLoad(() => life.lastDone() as Promise<LastDoneX[]>, active, [], { key: 'home.last-done' });
  const hidden = useHidden();
  const [askNode, ask] = useAsk();
  const [busy, setBusy] = useState<string | null>(null);

  const stamp = async (name: string) => {
    setBusy(name);
    const r = await act(life.stamp(name), 'Stamped');
    setBusy(null);
    if (r) void board.reload();
    return r !== null;
  };
  const rename = (r: LastDoneX) =>
    ask({
      title: 'Rename',
      label: 'Name',
      initial: r.name,
      save: 'Save',
      onSave: async (v) => {
        const x = await act(homeX.renameLastDone(r.id, v, r.note ?? undefined), 'Saved');
        if (x) void board.reload();
        return x !== null;
      },
    });
  const note = (r: LastDoneX) =>
    ask({
      title: `Note: ${r.name}`,
      label: 'Note',
      initial: r.note ?? '',
      placeholder: 'Every 2 weeks, the blue sheets',
      allowEmpty: true,
      save: 'Save',
      onSave: async (v) => {
        const x = await act(homeX.renameLastDone(r.id, r.name, v), 'Saved');
        if (x) void board.reload();
        return x !== null;
      },
    });
  const addOnly = () =>
    ask({
      title: 'Add to the board',
      label: 'Chore name',
      placeholder: 'Descale the kettle',
      hint: 'Added as not done yet.',
      save: 'Add',
      onSave: async (v) => {
        const x = await act(homeX.addLastDone(v), 'Added');
        if (x) void board.reload();
        return x !== null;
      },
    });
  const remove = (r: LastDoneX) =>
    deleteLater({
      text: `${r.name} removed`,
      hide: () => hidden.hide(r.id),
      restore: () => hidden.show(r.id),
      run: () => homeX.removeLastDone(r.id),
      after: () => void board.reload(),
    });

  return (
    <Section title="Last done" icon={IconClockCheck} right={<IconBtn icon={IconPlus} label="Add without stamping" variant="subtle" onClick={addOnly} />}>
      <Stack gap="sm">
        <LineForm label="Chore name" placeholder="Chore name" button="Stamp" maxLength={60} onSubmit={stamp} />
        <Async state={board} lines={4}>
          {(list) => {
            const rows = list.filter((r) => !hidden.has(r.id));
            if (rows.length === 0)
              return <Empty title="Nothing on the board">Things like "changed bedsheets" or "cut hair". Stamp them when done.</Empty>;
            return (
              <Stack gap={4}>
                {rows.map((r) => (
                  <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
                    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" lineClamp={1}>
                        {r.name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        <span className="num">{sinceText(r)}</span>
                        {r.note ? ` · ${r.note}` : ''}
                      </Text>
                    </Stack>
                    <Button size="xs" variant="light" loading={busy === r.name} onClick={() => void stamp(r.name)}>
                      Now
                    </Button>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" size="lg" aria-label={`More for ${r.name}`}>
                          <IconDots size={18} stroke={STROKE} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconPencil size={16} stroke={STROKE} />} onClick={() => rename(r)}>
                          Rename
                        </Menu.Item>
                        <Menu.Item leftSection={<IconBulb size={16} stroke={STROKE} />} onClick={() => note(r)}>
                          Note
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item color="red" leftSection={<IconTrash size={16} stroke={STROKE} />} onClick={() => remove(r)}>
                          Remove
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                ))}
              </Stack>
            );
          }}
        </Async>
      </Stack>
      {askNode}
    </Section>
  );
}

/* ---------- Removed ---------- */

const tableLabel = (t: string) => t.replace(/_/g, ' ');

function RemovedPane() {
  const active = usePageActive();
  const rem = useLoad(() => life.removed(), active, [], { key: 'home.removed' });
  const [busy, setBusy] = useState<string | null>(null);
  const restore = async (r: Removed) => {
    const k = `${r.table}:${r.id}`;
    setBusy(k);
    const x = await act(life.restore(r.table, r.id), 'Back');
    setBusy(null);
    if (x === null) return;
    rem.setData((rem.data ?? []).filter((y) => !(y.table === r.table && y.id === r.id)));
    emit('tasks', 'money', 'food', 'gym', 'body', 'notes', 'habits', 'goals');
  };
  return (
    <Section title="Recently removed" icon={IconArrowBackUp} hint="Last 14 days">
      <Async state={rem} lines={4}>
        {(list) =>
          list.length === 0 ? (
            <Empty title="Nothing removed lately" />
          ) : (
            <Stack gap={4}>
              {list.map((r) => (
                <Group key={`${r.table}:${r.id}`} justify="space-between" wrap="nowrap" gap="xs">
                  <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" lineClamp={1}>
                      {r.label || r.id}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {tableLabel(r.table)} · {f.ago(r.deleted_at)}
                    </Text>
                  </Stack>
                  <Button size="xs" variant="light" loading={busy === `${r.table}:${r.id}`} onClick={() => void restore(r)}>
                    Restore
                  </Button>
                </Group>
              ))}
            </Stack>
          )
        }
      </Async>
    </Section>
  );
}
