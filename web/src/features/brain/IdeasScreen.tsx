// Ideas: things parked for later. Three views under /brain/ideas:
//   index      someday ideas (make a task, do today), Inbox sort-five, compost
//   dump       brain dump (sorted before saving), park a thought, tasbih counter
//   questions  questions parked with their answers
import { Box, Button, Group, SegmentedControl, Select, Stack, Text, TextInput, Textarea, UnstyledButton } from '@mantine/core';
import { IconArrowRight, IconCalendarPlus, IconCheck, IconX } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { num, plural } from '../../fmt';
import { usePageActive } from '../../hooks';
import { go } from '../../router';
import { feel } from '../../sound';
import { emit, toast, toastUndo, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { act, useLoad } from '../../ui/data';
import { Md } from '../../ui/Md';
import { Empty, ErrorState, Loading, Page, Section } from '../../ui/Page';
import { v2, type DumpItem, type DumpResult, type Question, type V2Task } from '../../v2';
import { CompostLink, offerMerge, TriagePanel } from '../tasks/triage';
import { LineForm, Row, Rows } from './parts';

const BASE = '/brain/ideas';
const VIEWS = [
  { value: 'ideas', label: 'Ideas', path: BASE },
  { value: 'dump', label: 'Dump', path: `${BASE}/dump` },
  { value: 'questions', label: 'Questions', path: `${BASE}/questions` },
];

export function IdeasScreen() {
  const { pathname } = useLocation();
  const view = pathname.startsWith(`${BASE}/dump`) ? 'dump' : pathname.startsWith(`${BASE}/questions`) ? 'questions' : 'ideas';
  return (
    <Page
      title="Ideas"
      icon={PLACE_ICON.ideas}
      back="/brain"
      toolbar={
        <SegmentedControl
          fullWidth
          aria-label="Ideas view"
          value={view}
          data={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
          onChange={(v) => {
            go(VIEWS.find((x) => x.value === v)!.path);
          }}
        />
      }
    >
      <Routes>
        <Route index element={<IdeasView />} />
        <Route path="dump" element={<DumpView />} />
        <Route path="questions" element={<QuestionsView />} />
        <Route path="*" element={<IdeasView />} />
      </Routes>
    </Page>
  );
}

// ---------- ideas: someday list, Inbox sorting, compost ----------

function IdeasView() {
  const active = usePageActive();
  const ideas = useLoad(() => v2.tasks('someday'), active, [], { key: 'plan-ideas' });
  const projects = useLoad(() => v2.projects(), active, [], { key: 'plan-projects' });
  const [ver, setVer] = useState(0);
  const reload = () => {
    void ideas.reload();
    setVer((v) => v + 1);
  };
  useRefresh('tasks', reload);
  const [busyId, setBusyId] = useState<string | null>(null);

  const promote = async (t: V2Task, today: boolean) => {
    if (busyId) return;
    setBusyId(t.id);
    let r;
    try {
      r = await act(v2.patchTask(t.id, today ? { someday: false, due_date: lifeYmd() } : { someday: false }));
    } finally {
      setBusyId(null);
    }
    if (!r) return;
    feel('tap');
    ideas.setData((p) => (p ? p.filter((x) => x.id !== t.id) : p));
    emit('tasks');
    toastUndo(today ? 'On today' : 'Back in the list', () => {
      void act(v2.patchTask(t.id, { someday: true, due_date: t.due_date })).then((x) => {
        if (x) emit('tasks');
      });
    });
  };

  const add = async (text: string) => {
    const r = await act(v2.quickAdd(text, { someday: true }));
    if (!r) return false;
    feel('capture');
    emit('tasks');
    if (!offerMerge(r, reload)) toast('Parked');
    return true;
  };

  const list = ideas.data;
  return (
    <>
      <LineForm id="idea-add" label="Park an idea" placeholder="Park an idea" button="Park" onSubmit={add} maxLength={200} hideLabel />
      <Section title="Someday" hint={list && list.length > 0 ? num(list.length) : undefined} flush>
        {ideas.error && !list && (
          <Box p="md">
            <ErrorState error={ideas.error} onRetry={() => void ideas.reload()} />
          </Box>
        )}
        {!list && !ideas.error && (
          <Box p="md">
            <Loading label="Loading ideas" lines={3} />
          </Box>
        )}
        {list && list.length === 0 && (
          <Box p="md">
            <Empty title="No ideas parked.">Park one above. It waits here until you want it.</Empty>
          </Box>
        )}
        {list && list.length > 0 && (
          <Rows label="Someday ideas">
            {list.map((t) => (
              <Row key={t.id}>
                <Stack gap={6}>
                  <Box>
                    <Text size="sm" fw={600}>
                      {t.title}
                    </Text>
                    {t.notes && (
                      <Text size="xs" c="dimmed" lineClamp={3}>
                        {t.notes}
                      </Text>
                    )}
                  </Box>
                  <Group gap="xs">
                    <Button
                      size="compact-sm"
                      variant="light"
                      leftSection={<IconArrowRight size={14} stroke={STROKE} />}
                      disabled={busyId === t.id}
                      onClick={() => void promote(t, false)}
                    >
                      Make it a task
                    </Button>
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={<IconCalendarPlus size={14} stroke={STROKE} />}
                      disabled={busyId === t.id}
                      onClick={() => void promote(t, true)}
                    >
                      Do it today
                    </Button>
                  </Group>
                </Stack>
              </Row>
            ))}
          </Rows>
        )}
      </Section>
      <TriagePanel active={active} version={ver} projects={projects.data ?? []} onChanged={reload} />
      <CompostLink active={active} version={ver} onChanged={reload} />
    </>
  );
}

// ---------- dump: brain dump, park, tasbih ----------

function DumpView() {
  const active = usePageActive();
  return (
    <>
      <Section title="Brain dump">
        <DumpBox />
      </Section>
      <Section title="Park">
        <ParkBox active={active} />
      </Section>
      <Section title="Tasbih">
        <Tasbih />
      </Section>
    </>
  );
}

const KINDS: { value: DumpItem['kind']; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'expense', label: 'Expense' },
  { value: 'note', label: 'Note' },
];

function DumpBox() {
  const [text, setText] = useState('');
  const [items, setItems] = useState<DumpItem[] | null>(null);
  const [res, setRes] = useState<DumpResult | null>(null);
  const [busy, setBusy] = useState(false);

  const split = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await act(v2.brainDump(text));
    setBusy(false);
    if (r) {
      setItems(r.items);
      setRes(null);
    }
  };
  const commit = async () => {
    if (!items?.length || busy) return;
    setBusy(true);
    const r = await act(v2.brainDumpCommit(items));
    setBusy(false);
    if (r) {
      feel('capture');
      setRes(r);
      setItems(null);
      setText('');
      emit('tasks', 'money', 'notes');
    }
  };
  const edit = (i: number, p: Partial<DumpItem>) => setItems((xs) => (xs ? xs.map((x, j) => (j === i ? { ...x, ...p } : x)) : xs));

  return (
    <Stack gap="sm">
      {!items && (
        <form onSubmit={split}>
          <Stack gap="sm">
            <Textarea
              id="dump-text"
              data-draft
              label="Everything on your mind"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              rows={6}
              placeholder={'Everything on your mind, one per line.\ncall the bank\ncoffee 4 usd\nidea: a one-page menu for cafés'}
            />
            <Group>
              <Button type="submit" loading={busy} disabled={!text.trim()}>
                Sort it
              </Button>
            </Group>
          </Stack>
        </form>
      )}
      {items && (
        <>
          <Text size="sm" c="dimmed">
            Check the sorting. Nothing is saved until you tap Save all.
          </Text>
          {items.length === 0 && (
            <Text size="sm" c="dimmed">
              Nothing left to save.
            </Text>
          )}
          <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
            {items.map((it, i) => (
              <Group key={i} component="li" gap="xs" wrap="nowrap" align="center">
                <Select
                  aria-label="Kind"
                  w={112}
                  allowDeselect={false}
                  data={KINDS}
                  value={it.kind}
                  onChange={(v) => v && edit(i, { kind: v as DumpItem['kind'] })}
                />
                <TextInput aria-label="Text" style={{ flex: 1, minWidth: 0 }} value={it.text} onChange={(e) => edit(i, { text: e.currentTarget.value })} />
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  aria-label={`Drop this line: ${it.text}`}
                  onClick={() => setItems((xs) => (xs ? xs.filter((_, j) => j !== i) : xs))}
                >
                  Drop
                </Button>
              </Group>
            ))}
          </Stack>
          <Group gap="xs">
            <Button loading={busy} disabled={!items.length} onClick={() => void commit()}>
              Save all
            </Button>
            <Button variant="default" onClick={() => setItems(null)}>
              Back
            </Button>
          </Group>
        </>
      )}
      {res && (
        <Text size="sm" c="dimmed" aria-live="polite" className="num">
          Saved {plural(res.tasks, 'task')}, {plural(res.expenses, 'expense')}, {plural(res.notes, 'note')}.
          {res.failed.length > 0 && ` ${num(res.failed.length)} could not be read: ${res.failed.map((x) => `“${x.text}”`).join(', ')}.`}
        </Text>
      )}
    </Stack>
  );
}

function ParkBox({ active }: { active: boolean }) {
  const list = useLoad(() => v2.parked(), active, [], { key: 'parked' });
  useRefresh('tasks', () => void list.reload());
  const [busyId, setBusyId] = useState<string | null>(null);
  const park = async (t: string) => {
    const r = await act(v2.park(t));
    if (!r) return false;
    feel('capture');
    toast(r.message || 'Parked');
    emit('tasks');
    void list.reload();
    return true;
  };
  const done = async (t: V2Task) => {
    if (busyId) return;
    setBusyId(t.id);
    let r;
    try {
      r = await act(v2.done(t.id), 'Done');
    } finally {
      setBusyId(null);
    }
    if (r) {
      feel('done');
      list.setData((p) => (p ? p.filter((x) => x.id !== t.id) : p));
      emit('tasks');
    }
  };
  const items = (list.data ?? []).slice(0, 12);
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        A thought that pulls you out of focus. Park it, go back. It waits in Someday.
      </Text>
      <LineForm id="park-line" label="Park a thought" placeholder="Look up that course later" button="Park" onSubmit={park} hideLabel />
      {list.error && !list.data && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
      {items.length > 0 && (
        <Stack gap={4} component="ul" m={0} p={0} aria-label="Parked thoughts" style={{ listStyle: 'none' }}>
          {items.map((t) => (
            <Group key={t.id} component="li" justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" lineClamp={2} style={{ flex: 1, minWidth: 0 }}>
                {t.title}
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconCheck size={14} stroke={STROKE} />}
                aria-label={`Mark done: ${t.title}`}
                disabled={busyId === t.id}
                onClick={() => void done(t)}
              >
                Done
              </Button>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

const TASBIH_KEY = 'mosaic.tasbih';

function Tasbih() {
  const [n, setN] = useState(() => {
    try {
      return Number(localStorage.getItem(TASBIH_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const set = (v: number) => {
    setN(v);
    try {
      localStorage.setItem(TASBIH_KEY, String(v));
    } catch {
      /* storage blocked: session only */
    }
  };
  const tapOne = () => {
    const v = n + 1;
    set(v);
    if (v % 33 === 0) feel('done');
    else if ('vibrate' in navigator) navigator.vibrate?.(8);
  };
  const reset = () => {
    const before = n;
    if (!before) return;
    set(0);
    toastUndo('Count reset', () => set(before));
  };
  return (
    <Stack gap="xs" align="center">
      <UnstyledButton
        onClick={tapOne}
        aria-label={`Count, now ${num(n)}`}
        w={160}
        h={160}
        style={{
          borderRadius: '50%',
          border: '2px solid var(--mantine-color-default-border)',
          display: 'grid',
          placeItems: 'center',
          touchAction: 'manipulation',
          userSelect: 'none',
        }}
      >
        <Text className="num" fz="var(--app-fz-display)" fw={600}>
          {num(n)}
        </Text>
      </UnstyledButton>
      <Text size="sm" c="dimmed" className="num">
        Round {num(Math.floor(n / 33) + 1)} · {num(n % 33)} of {num(33)}
      </Text>
      <Button variant="subtle" color="gray" size="compact-sm" onClick={reset} disabled={!n}>
        Reset
      </Button>
    </Stack>
  );
}

// ---------- questions ----------

function QuestionsView() {
  const active = usePageActive();
  const [status, setStatus] = useState<'open' | 'answered'>('open');
  const r = useLoad(() => v2.questions(status), active, [status], { key: `questions-${status}` });
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (q: string) => {
    if (q.trim().length < 5) {
      toast('A few more words');
      return false;
    }
    const x = await act(v2.addQuestion(q.trim()));
    if (!x) return false;
    feel('capture');
    toast(x.duplicate ? 'Already parked' : 'Question parked');
    if (status === 'open') void r.reload();
    return true;
  };
  const answer = async (x: Question) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const a = await act(v2.answerQuestion(x.id, text.trim()));
    setBusy(false);
    if (a) {
      feel('done');
      setEditing(null);
      setText('');
      void r.reload();
    }
  };
  const drop = async (x: Question) => {
    if (await act(v2.dropQuestion(x.id), 'Dropped')) void r.reload();
  };

  return (
    <>
      <LineForm id="question-add" label="Park a question" placeholder="Park a question" button="Park" onSubmit={add} maxLength={300} hideLabel />
      <Section
        title="Questions"
        flush
        right={
          <Group gap={4} role="group" aria-label="Question filter">
            <Button size="compact-sm" variant={status === 'open' ? 'light' : 'subtle'} aria-pressed={status === 'open'} onClick={() => setStatus('open')}>
              Open
            </Button>
            <Button
              size="compact-sm"
              variant={status === 'answered' ? 'light' : 'subtle'}
              aria-pressed={status === 'answered'}
              onClick={() => setStatus('answered')}
            >
              Answered
            </Button>
          </Group>
        }
      >
        {!r.data && r.error && (
          <Box p="md">
            <ErrorState error={r.error} onRetry={() => void r.reload()} />
          </Box>
        )}
        {!r.data && !r.error && (
          <Box p="md">
            <Loading label="Loading questions" lines={3} />
          </Box>
        )}
        {r.data && r.data.length === 0 && (
          <Box p="md">
            <Empty title={status === 'open' ? 'No open questions.' : 'No answers yet.'} />
          </Box>
        )}
        {r.data && r.data.length > 0 && (
          <Box aria-busy={r.loading || undefined}>
            <Rows label={status === 'open' ? 'Open questions' : 'Answered questions'}>
              {r.data.map((x) => (
                <Row key={x.id}>
                  <Stack gap={6}>
                    <Text size="sm" fw={600}>
                      {x.text}
                    </Text>
                    {x.answer_md && <Md src={x.answer_md} />}
                    {x.status === 'open' &&
                      (editing === x.id ? (
                        <Stack gap="xs">
                          <Textarea
                            data-draft
                            aria-label="Answer"
                            autosize
                            minRows={3}
                            value={text}
                            autoFocus
                            onChange={(e) => setText(e.currentTarget.value)}
                          />
                          <Group gap="xs">
                            <Button size="compact-sm" loading={busy} disabled={!text.trim()} onClick={() => void answer(x)}>
                              Save answer
                            </Button>
                            <Button size="compact-sm" variant="default" onClick={() => setEditing(null)}>
                              Back
                            </Button>
                          </Group>
                        </Stack>
                      ) : (
                        <Group gap="xs">
                          <Button
                            size="compact-sm"
                            variant="light"
                            onClick={() => {
                              setEditing(x.id);
                              setText('');
                            }}
                          >
                            Answer
                          </Button>
                          <Button
                            size="compact-sm"
                            variant="subtle"
                            color="gray"
                            leftSection={<IconX size={14} stroke={STROKE} />}
                            onClick={() => void drop(x)}
                          >
                            Drop
                          </Button>
                        </Group>
                      ))}
                  </Stack>
                </Row>
              ))}
            </Rows>
          </Box>
        )}
      </Section>
    </>
  );
}
