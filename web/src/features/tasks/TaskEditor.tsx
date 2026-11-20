import { Anchor, Button, Chip, Group, NumberInput, SegmentedControl, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput, TimeInput } from '@mantine/dates';
import '@mantine/dates/styles.css';
import { IconCalendar, IconClock } from '@tabler/icons-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { asApiError } from '../../api';
import { STROKE } from '../../app/icons';
import { emit, toast, toastUndo } from '../../store';
import { lifeYmd } from '../../time';
import { act } from '../../ui/data';
import { Sheet } from '../../ui/Sheet';
import { v2, type TaskInput, type V2Project, type V2Task } from '../../v2';
import { EstimateHintLine } from './triage';
import { tomorrow } from './util';

/** priority is stored as priority 3 (the API has no dedicated field). if-time = anything below. */
export const isMust = (t: Pick<V2Task, 'priority'>) => t.priority >= 3;

type Draft = {
  title: string;
  first: string;
  doneDef: string;
  est: number | null;
  due: string;
  dueTime: string;
  /** '' = Inbox. */
  project: string;
  must: boolean;
  notes: string;
};

const draftOf = (t: V2Task): Draft => ({
  title: t.title,
  first: t.first_action ?? '',
  doneDef: t.done_def ?? '',
  est: t.est_minutes ?? null,
  due: t.due_date ?? '',
  dueTime: t.due_time?.slice(0, 5) ?? '',
  project: t.project_name && t.project_name !== 'Inbox' ? t.project_name : '',
  must: isMust(t),
  notes: t.notes ?? '',
});

const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
const STEP = 5;
/** Select cannot hold an empty value; Inbox uses this key in the picker only. */
const INBOX = '__inbox';

export type TaskEditorProps = {
  task: V2Task;
  projects: V2Project[];
  /** `sheet`: explicit Save / Cancel. `pane`: desktop detail pane, saves on blur. */
  mode?: 'sheet' | 'pane';
  onClose: () => void;
  /** After any write (save, someday, delete). The editor already emitted "tasks". */
  onSaved?: (t: V2Task | null) => void;
};

/** The task form. Title, weight, project, minutes, first action, done means, day, time, notes. */
export function TaskEditor({ task, projects, mode = 'sheet', onClose, onSaved }: TaskEditorProps) {
  const uid = useId().replace(/:/g, '');
  const [d, setD] = useState<Draft>(() => draftOf(task));
  const saved = useRef<Draft>(draftOf(task));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const pane = mode === 'pane';

  // The same task changed elsewhere: take the server copy, unless there are unsaved edits here.
  const dRef = useRef(d);
  dRef.current = d;
  useEffect(() => {
    const next = draftOf(task);
    if (same(dRef.current, saved.current)) setD(next);
    saved.current = next;
  }, [task]);

  const payload = (x: Draft): TaskInput => ({
    title: x.title.trim(),
    first_action: x.first.trim() || null,
    done_def: x.doneDef.trim() || null,
    est_minutes: x.est && x.est > 0 ? x.est : null,
    due_date: x.due || null,
    due_time: x.due && x.dueTime ? x.dueTime : null,
    project: x.project || null,
    priority: x.must ? 3 : task.priority >= 3 ? 0 : task.priority,
    notes: x.notes,
  });

  /** Saves run one at a time: a blur and a chip tap in the same instant must not race. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Save when something changed. Returns true when the form may close. */
  const commit = (x: Draft = dRef.current): Promise<boolean> => {
    const run = queue.current.then(() => save(x));
    queue.current = run;
    return run;
  };
  const save = async (x: Draft): Promise<boolean> => {
    if (same(x, saved.current)) return true;
    if (!x.title.trim()) {
      toast('A task needs a title');
      return false;
    }
    setBusy(true);
    setStatus('Saving');
    try {
      const r = await v2.patchTask(task.id, payload(x));
      saved.current = x;
      setStatus('Saved');
      emit('tasks');
      onSaved?.(r);
      return true;
    } catch (e) {
      setStatus('');
      toast(asApiError(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Change a field. Discrete pickers save at once in the pane; text fields save on blur. */
  const set = <K extends keyof Draft>(k: K, v: Draft[K], now = false) => {
    const next = { ...dRef.current, [k]: v };
    dRef.current = next;
    setD(next);
    if (pane && now) void commit(next);
  };
  const blur = () => {
    if (pane) void commit();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await commit()) {
      if (!pane) {
        toast('Saved');
        onClose();
      }
    }
  };

  const someday = async () => {
    const r = await act(v2.patchTask(task.id, { someday: !task.someday }), task.someday ? 'Back in the list' : 'Parked for someday');
    if (!r) return;
    emit('tasks');
    onSaved?.(r);
    onClose();
  };

  /** No confirm: the task goes to trash and the toast offers Undo. */
  const remove = async () => {
    const r = await act(v2.removeTask(task.id));
    if (!r) return;
    emit('tasks');
    onSaved?.(null);
    onClose();
    toastUndo('Moved to trash', () => {
      void act(v2.restore(task.id)).then((x) => {
        if (x) emit('tasks');
      });
    });
  };

  const others = projects.filter((p) => p.name !== 'Inbox');
  const projectData = [{ value: INBOX, label: 'Inbox' }, ...others.map((p) => ({ value: p.name, label: p.name }))];
  // A project the list does not know yet (renamed, archived) still shows.
  if (d.project && !others.some((p) => p.name === d.project)) projectData.push({ value: d.project, label: d.project });
  const today = lifeYmd();
  const tmrw = tomorrow();
  const dayChip = d.due === today ? 'today' : d.due === tmrw ? 'tomorrow' : !d.due ? 'none' : '';

  return (
    <form onSubmit={submit} aria-label="Edit task">
      <Stack gap="sm">
        <TextInput
          label="Title"
          value={d.title}
          onChange={(e) => set('title', e.currentTarget.value)}
          onBlur={blur}
          maxLength={200}
          autoComplete="off"
          required
        />

        <Stack gap={4}>
          <Text size="sm" fw={600} id={`${uid}-must`}>
            Weight
          </Text>
          <SegmentedControl
            aria-labelledby={`${uid}-must`}
            value={d.must ? 'must' : 'iftime'}
            onChange={(v) => set('must', v === 'must', true)}
            data={[
              { value: 'must', label: 'Priority' },
              { value: 'iftime', label: 'If time' },
            ]}
            fullWidth
          />
        </Stack>

        <Group grow align="flex-start" gap="sm">
          <Select
            label="Project"
            data={projectData}
            value={d.project || INBOX}
            onChange={(v) => set('project', !v || v === INBOX ? '' : v, true)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <NumberInput
            label="Minutes"
            placeholder="25"
            min={0}
            max={1440}
            step={STEP}
            clampBehavior="strict"
            allowDecimal={false}
            allowNegative={false}
            value={d.est ?? ''}
            onChange={(v) => {
              const n = typeof v === 'number' ? v : Number(v);
              set('est', Number.isFinite(n) && n > 0 ? Math.min(1440, Math.round(n)) : null);
            }}
            onBlur={blur}
            classNames={{ input: 'num' }}
          />
        </Group>
        <EstimateHintLine minutes={d.est ? String(d.est) : ''} tags={task.tags ?? []} onUse={(n) => set('est', n, true)} />

        <TextInput
          label="First action (under 2 minutes)"
          placeholder="Open the doc"
          value={d.first}
          onChange={(e) => set('first', e.currentTarget.value)}
          onBlur={blur}
          autoComplete="off"
        />
        <TextInput
          label="Done means"
          placeholder="10 pages read"
          value={d.doneDef}
          onChange={(e) => set('doneDef', e.currentTarget.value)}
          onBlur={blur}
          autoComplete="off"
        />

        <Stack gap={6}>
          <Group grow align="flex-end" gap="sm">
            <DatePickerInput
              label="Day"
              placeholder="No day"
              value={d.due || null}
              onChange={(v) => set('due', v ? String(v).slice(0, 10) : '', true)}
              valueFormat="ddd D MMM"
              firstDayOfWeek={1}
              clearable
              leftSection={<IconCalendar size={16} stroke={STROKE} />}
              popoverProps={{ withinPortal: true }}
            />
            <TimeInput
              label="Time"
              value={d.dueTime}
              disabled={!d.due}
              onChange={(e) => set('dueTime', e.currentTarget.value)}
              onBlur={blur}
              leftSection={<IconClock size={16} stroke={STROKE} />}
            />
          </Group>
          <Chip.Group
            multiple={false}
            value={dayChip}
            onChange={(v) => {
              if (v === 'today') set('due', today, true);
              else if (v === 'tomorrow') set('due', tmrw, true);
              else if (v === 'none') set('due', '', true);
            }}
          >
            <Group gap={6} role="group" aria-label="Quick day">
              <Chip value="today" size="sm">
                Today
              </Chip>
              <Chip value="tomorrow" size="sm">
                Tomorrow
              </Chip>
              <Chip value="none" size="sm">
                No day
              </Chip>
            </Group>
          </Chip.Group>
        </Stack>

        <Textarea
          label="Notes"
          value={d.notes}
          onChange={(e) => set('notes', e.currentTarget.value)}
          onBlur={blur}
          minRows={pane ? 6 : 3}
          autosize
          maxRows={14}
        />

        <Group justify="space-between">
          <Anchor component="button" type="button" size="sm" onClick={() => void someday()}>
            {task.someday ? 'Back in the list' : 'Park for someday'}
          </Anchor>
          <Anchor component="button" type="button" size="sm" c="red" onClick={() => void remove()}>
            Delete
          </Anchor>
        </Group>

        {pane ? (
          <Group justify="space-between" pt="xs">
            <Text size="xs" c="dimmed" role="status" aria-live="polite">
              {busy ? 'Saving…' : status}
            </Text>
            <Button variant="default" onClick={() => void commit().then((ok) => ok && onClose())}>
              Close
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end" pt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  );
}

/** Phone editor: a bottom sheet (a modal on larger screens). */
export function TaskEditorSheet({ task, projects, onClose, onSaved }: Omit<TaskEditorProps, 'mode' | 'task'> & { task: V2Task | null }) {
  // Keep the last task on screen while the sheet slides away.
  const last = useRef<V2Task | null>(task);
  if (task) last.current = task;
  const shown = task ?? last.current;
  return (
    <Sheet opened={!!task} onClose={onClose} title="Edit task" tall>
      {shown && <TaskEditor key={shown.id} task={shown} projects={projects} mode="sheet" onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}
