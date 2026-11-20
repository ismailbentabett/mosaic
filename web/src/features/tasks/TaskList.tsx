// One task list (any view): add row, rows, Done today, the detail pane or sheet, Move, bulk select and keys.
import { Anchor, Box, Button, Chip, Collapse, Grid, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCalendarOff, IconCalendarPlus, IconCheck, IconChevronDown, IconChevronRight, IconFolder, IconMoon, IconSun, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { overlayOpen } from '../../app/back';
import { STROKE } from '../../app/icons';
import { reducedMotion } from '../../feel';
import * as f from '../../fmt';
import { replace } from '../../router';
import { feel } from '../../sound';
import { emit, toastUndo, useRefresh } from '../../store';
import { lifeYmd } from '../../time';
import { act, useLoad } from '../../ui/data';
import { Empty, ErrorState, Loading, Section } from '../../ui/Page';
import { Sheet } from '../../ui/Sheet';
import { v2, type TaskInput, type V2Project, type V2Task, type V2View } from '../../v2';
import { AddRow, focusAdd } from './AddRow';
import { TaskEditor, TaskEditorSheet } from './TaskEditor';
import { TaskRow } from './TaskRow';
import { CompostLink, EstimatesReadout, FitsCard, TriagePanel } from './triage';
import { dayLabel, EMPTY, isTyping, LEAVE_MS, tasksPath, tomorrow, wait, type TaskView } from './util';

/** Inbox is "no project" on the server; sending the name would create a real project called Inbox. */
const projectOf = (t: V2Task) => (t.project_name && t.project_name !== 'Inbox' ? t.project_name : null);
const toProject = (name: string) => (name === 'Inbox' ? null : name);

/** What a task looked like before a move, so Undo can put it back. */
const beforeOf = (t: V2Task): TaskInput => ({ due_date: t.due_date, due_time: t.due_time, project: projectOf(t), someday: t.someday });

/** True while a modal, sheet or menu is open: page keys stay quiet. */
const overlayUp = () => overlayOpen() || !!document.querySelector('[role="dialog"], [role="menu"]');

export type TaskListProps = {
  view: TaskView;
  project: string | null;
  active: boolean;
  /** Desktop: the editor is a side pane. Phone and tablet: a sheet. */
  wide: boolean;
  /** Bulk select mode (toggled from the page header). */
  picking: boolean;
  onPickingChange: (on: boolean) => void;
};

export function TaskList({ view, project, active, wide, picking, onPickingChange }: TaskListProps) {
  const apiView: V2View = view === 'projects' ? 'all' : view;
  const needsProject = view === 'projects';
  const list = useLoad(
    () => (needsProject && !project ? Promise.resolve([] as V2Task[]) : v2.tasks(apiView, needsProject ? project : undefined)),
    active,
    [apiView, project],
    { key: `plan-list-${view}-${project ?? ''}` },
  );
  const doneToday = useLoad(() => v2.tasks('done'), active && view === 'today', [view], { key: 'plan-done-today' });
  const projects = useLoad(() => v2.projects(), active, [], { key: 'plan-projects' });
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<V2Task[]>([]);
  const [showDone, setShowDone] = useState(false);
  /** Desktop pane: the task open on the right. Kept even when a save moves it out of this list. */
  const [editTask, setEditTask] = useState<V2Task | null>(null);
  const [sheetTask, setSheetTask] = useState<V2Task | null>(null);
  const [moving, setMoving] = useState<V2Task | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ver, setVer] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const today = lifeYmd();
  const projectList: V2Project[] = projects.data ?? [];

  // A new view starts with nothing picked and no session "done" rows.
  useEffect(() => {
    setPicked(new Set());
    setSession([]);
    setShowDone(false);
  }, [view, project]);
  useEffect(() => {
    if (!picking) setPicked(new Set());
  }, [picking]);

  const reloadAll = () => {
    void list.reload();
    if (view === 'today') void doneToday.reload();
    void projects.reload();
    setVer((v) => v + 1);
  };
  useRefresh('tasks', reloadAll);

  const showsDone = view === 'done' || view === 'all';
  const rows = useMemo(() => {
    const all = list.data ?? [];
    return showsDone ? all : all.filter((t) => t.status === 'open');
  }, [list.data, showsDone]);

  const doneGroup = useMemo(() => {
    if (showsDone) return [];
    const server =
      view === 'today'
        ? (doneToday.data ?? []).filter((t) => t.done_at && lifeYmd(t.done_at) === today)
        : view === 'projects'
          ? (list.data ?? []).filter((t) => t.status === 'done' && t.done_at && lifeYmd(t.done_at) === today)
          : [];
    const seen = new Set<string>();
    return [...session, ...server].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [session, doneToday.data, list.data, view, showsDone, today]);

  // Keys: n adds, j / k walk the rows, Esc leaves bulk select. Typing, modifiers and open overlays win.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target) || overlayUp()) return;
      if (e.key === 'n' && view !== 'done') {
        e.preventDefault();
        focusAdd();
      } else if (e.key === 'j' || e.key === 'k') {
        const bodies = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row-body]') ?? []);
        if (!bodies.length) return;
        e.preventDefault();
        const at = bodies.findIndex((b) => b === document.activeElement);
        const next = at < 0 ? (e.key === 'j' ? 0 : bodies.length - 1) : Math.min(bodies.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)));
        bodies[next]?.focus();
        bodies[next]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Escape' && picking) {
        e.preventDefault();
        onPickingChange(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, view, picking, onPickingChange]);

  const complete = async (t: V2Task) => {
    setLeaving((s) => new Set(s).add(t.id));
    feel('done');
    const [r] = await Promise.all([act(v2.done(t.id)), wait(reducedMotion() ? 0 : LEAVE_MS)]);
    setLeaving((s) => {
      const n = new Set(s);
      n.delete(t.id);
      return n;
    });
    if (!r) return; // act() already said why; the row stays open
    // Open-only views filter done rows out, so swapping in the done copy removes the row.
    list.setData((p) => (p ?? []).map((x) => (x.id === t.id ? r : x)));
    if (!showsDone) setSession((s) => [r, ...s.filter((x) => x.id !== t.id)]);
    emit('tasks');
    toastUndo('Done', () => void reopen(r));
  };

  const reopen = async (t: V2Task) => {
    setSession((s) => s.filter((x) => x.id !== t.id));
    doneToday.setData((p) => (p ? p.filter((x) => x.id !== t.id) : p));
    const r = await act(v2.reopen(t.id));
    if (!r) {
      reloadAll();
      return;
    }
    feel('undo');
    list.setData((p) => {
      const cur = p ?? [];
      return cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? r : x)) : [r, ...cur];
    });
    emit('tasks');
  };

  const toggle = (t: V2Task) => {
    if (leaving.has(t.id)) return;
    if (t.status === 'done') void reopen(t);
    else void complete(t);
  };

  /** A write with an Undo that patches the task back to `before`. */
  const moveRun = async (t: V2Task, p: Promise<unknown>, said: string, before: TaskInput = beforeOf(t)) => {
    if (!(await act(p))) return;
    emit('tasks');
    toastUndo(said, () => {
      void act(v2.patchTask(t.id, before)).then((x) => {
        if (x) emit('tasks');
      });
    });
  };

  const edit = (t: V2Task) => {
    feel('tap');
    if (wide) setEditTask(t);
    else setSheetTask(t);
  };
  const pick = (t: V2Task) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(t.id)) n.delete(t.id);
      else n.add(t.id);
      return n;
    });
  const editId = editTask?.id ?? null;
  // Fresh server copy when the task is still in this list; otherwise the last saved copy.
  const editing = editTask ? (rows.find((t) => t.id === editTask.id) ?? doneGroup.find((t) => t.id === editTask.id) ?? editTask) : null;

  const toToday = async (t: V2Task) => {
    if (await act(v2.setDay([t.id], lifeYmd()), 'On today')) emit('tasks');
  };

  /** Someday rows: bring one back into the list, or straight onto today. */
  const promote = (t: V2Task, onToday: boolean) =>
    void moveRun(
      t,
      v2.patchTask(t.id, onToday ? { someday: false, due_date: lifeYmd() } : { someday: false }),
      onToday ? 'On today' : 'Back in the list',
      { someday: true, due_date: t.due_date },
    );

  const sideFor = (t: V2Task): ReactNode => {
    if (picking || t.status !== 'open') return undefined;
    if (view === 'needs_day')
      return (
        <Button size="compact-sm" variant="subtle" onClick={() => void toToday(t)}>
          Today
        </Button>
      );
    if (view === 'someday')
      return (
        <Group gap={4} wrap="nowrap">
          <Button size="compact-sm" variant="subtle" onClick={() => promote(t, false)}>
            Make it a task
          </Button>
          <Button size="compact-sm" variant="subtle" onClick={() => promote(t, true)}>
            Do it today
          </Button>
        </Group>
      );
    return undefined;
  };

  const totalMin = rows.reduce((s, t) => s + (t.status === 'open' ? (t.est_minutes ?? 0) : 0), 0);
  const rowProps = (t: V2Task) => ({
    task: t,
    state: leaving.has(t.id) ? ('leaving' as const) : t.status === 'done' ? ('done' as const) : ('open' as const),
    selected: wide && editId === t.id,
    onToggle: toggle,
    onEdit: edit,
    onMove: setMoving,
    hideProject: view === 'inbox' || view === 'projects',
    hideDay: view === 'today',
    side: sideFor(t),
    picking,
    picked: picked.has(t.id),
    onPick: pick,
  });

  // Upcoming: one group per day, "No day" last.
  const groups = useMemo(() => {
    if (view !== 'upcoming') return [];
    const by = new Map<string, V2Task[]>();
    for (const t of rows) {
      const k = t.due_date ?? '';
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [rows, view]);

  /* ---------- bulk ---------- */

  const chosen = rows.filter((t) => picked.has(t.id) && t.status === 'open');
  const bulk = async (said: string, run: (t: V2Task) => Promise<unknown>, undo: (t: V2Task) => Promise<unknown>, all?: () => Promise<unknown>) => {
    const ts = chosen;
    if (!ts.length || bulkBusy) return;
    setBulkBusy(true);
    let ok: V2Task[] = [];
    try {
      if (all) {
        if (await act(all())) ok = ts;
      } else {
        for (const t of ts) if (await act(run(t))) ok.push(t);
      }
    } finally {
      setBulkBusy(false);
    }
    if (!ok.length) return;
    feel('tap');
    onPickingChange(false);
    emit('tasks');
    toastUndo(`${said}: ${f.plural(ok.length, 'task')}`, () => {
      void Promise.all(ok.map((t) => act(undo(t)))).then(() => emit('tasks'));
    });
  };
  const putBack = (t: V2Task) => v2.patchTask(t.id, beforeOf(t));
  const bulkDay = (day: string | null, said: string) =>
    void bulk(said, () => Promise.resolve(null), putBack, () => v2.setDay(chosen.map((t) => t.id), day));
  const bulkBar = picking && (
    <Box
      pos="sticky"
      top="var(--app-shell-header-offset, 0px)"
      py="xs"
      style={{ zIndex: 3, background: 'var(--mantine-color-body)', borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs">
          <Text size="sm" fw={600} className="num" aria-live="polite">
            {f.num(chosen.length)} selected
          </Text>
          <Anchor
            component="button"
            type="button"
            size="sm"
            onClick={() => setPicked(chosen.length === rows.filter((t) => t.status === 'open').length ? new Set() : new Set(rows.filter((t) => t.status === 'open').map((t) => t.id)))}
          >
            {chosen.length && chosen.length === rows.filter((t) => t.status === 'open').length ? 'Select none' : 'Select all'}
          </Anchor>
        </Group>
        <Group gap={6} wrap="wrap">
          <Button size="compact-sm" variant="default" disabled={!chosen.length} loading={bulkBusy} leftSection={<IconSun size={14} stroke={STROKE} />} onClick={() => bulkDay(lifeYmd(), 'Moved to today')}>
            Today
          </Button>
          <Button size="compact-sm" variant="default" disabled={!chosen.length || bulkBusy} leftSection={<IconCalendarPlus size={14} stroke={STROKE} />} onClick={() => bulkDay(tomorrow(), 'Moved to tomorrow')}>
            Tomorrow
          </Button>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button size="compact-sm" variant="default" disabled={!chosen.length || bulkBusy}>
                More
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconCheck size={16} stroke={STROKE} />} onClick={() => void bulk('Done', (t) => v2.done(t.id), (t) => v2.reopen(t.id))}>
                Done
              </Menu.Item>
              <Menu.Item leftSection={<IconCalendarOff size={16} stroke={STROKE} />} onClick={() => bulkDay(null, 'Day cleared')}>
                No day
              </Menu.Item>
              <Menu.Item leftSection={<IconMoon size={16} stroke={STROKE} />} onClick={() => void bulk('Parked for someday', (t) => v2.patchTask(t.id, { someday: true }), putBack)}>
                Someday
              </Menu.Item>
              {projectList.length > 0 && <Menu.Label>Move to</Menu.Label>}
              {projectList.map((p) => (
                <Menu.Item
                  key={p.id}
                  leftSection={<IconFolder size={16} stroke={STROKE} />}
                  onClick={() => void bulk(`Moved to ${p.name}`, (t) => v2.patchTask(t.id, { project: toProject(p.name) }), putBack)}
                >
                  {p.name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Button size="compact-sm" variant="subtle" color="gray" leftSection={<IconX size={14} stroke={STROKE} />} onClick={() => onPickingChange(false)}>
            Cancel
          </Button>
        </Group>
      </Group>
    </Box>
  );

  /* ---------- render ---------- */

  const rowList = (ts: V2Task[], extra?: Partial<ReturnType<typeof rowProps>>) => (
    <Stack gap={0}>
      {ts.map((t) => (
        <TaskRow key={t.id} {...rowProps(t)} {...extra} />
      ))}
    </Stack>
  );

  const main = (
    <Stack gap="md" ref={listRef}>
      {view === 'projects' && (
        <Stack gap="xs">
          {!projects.data && projects.loading && <Loading label="Loading projects" lines={1} />}
          {projects.error && !projects.data && <ErrorState error={projects.error} onRetry={() => void projects.reload()} />}
          {projectList.length > 0 && (
            <Group gap={6} role="group" aria-label="Projects">
              {projectList.map((p) => (
                <Chip key={p.id} checked={project === p.name} onChange={() => replace(tasksPath('projects', p.name))} variant="light">
                  {p.name} <span className="num">{f.num(p.open_count)}</span>
                </Chip>
              ))}
            </Group>
          )}
        </Stack>
      )}

      {view !== 'done' && (view !== 'projects' || project) && !picking && <AddRow view={view} project={project} onAdded={reloadAll} />}

      {view === 'inbox' && (
        <>
          <Text size="sm" c="dimmed">
            Promote max 1 a day.
          </Text>
          <TriagePanel active={active} version={ver} projects={projectList} onChanged={reloadAll} />
        </>
      )}

      {bulkBar}

      {view === 'projects' && !project ? (
        <Text size="sm" c="dimmed">
          Pick a project.
        </Text>
      ) : (
        <>
          {list.error && !list.data && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
          {!list.data && list.loading && <Loading label="Loading tasks" lines={4} />}
          {list.data && rows.length === 0 && (
            <Empty
              title={EMPTY[view]}
              action={
                view === 'today' ? (
                  <Button variant="light" onClick={focusAdd}>
                    Add task
                  </Button>
                ) : undefined
              }
            />
          )}
          {rows.length > 0 && (
            <>
              {totalMin > 0 && !showsDone && (
                <Text size="xs" c="dimmed" className="num">
                  {f.plural(rows.length, 'task')} · {f.minutes(totalMin)} estimated
                </Text>
              )}
              {view === 'upcoming' ? (
                groups.map(([d, ts]) => (
                  <Section key={d || 'none'} title={d ? dayLabel(d) : 'No day'} hint={<span className="num">{f.num(ts.length)}</span>} flush>
                    <Box px={4} pb={4}>
                      {rowList(ts, { hideDay: true })}
                    </Box>
                  </Section>
                ))
              ) : (
                <Section flush>
                  <Box p={4}>{rowList(rows)}</Box>
                </Section>
              )}
            </>
          )}
        </>
      )}

      {doneGroup.length > 0 && (
        <Stack gap="xs" component="section" aria-label="Done today">
          <UnstyledButton className="tap" aria-expanded={showDone} onClick={() => setShowDone((o) => !o)} style={{ alignSelf: 'flex-start', justifyContent: 'flex-start' }}>
            <Group gap={4}>
              {showDone ? <IconChevronDown size={16} stroke={STROKE} /> : <IconChevronRight size={16} stroke={STROKE} />}
              <Text size="sm" c="dimmed">
                Done today (<span className="num">{f.num(doneGroup.length)}</span>)
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse expanded={showDone}>
            {showDone && (
              <Section flush>
                <Box p={4}>
                  <Stack gap={0}>
                    {doneGroup.map((t) => (
                      <TaskRow key={t.id} {...rowProps({ ...t, status: 'done' })} state="done" onMove={undefined} side={undefined} picking={false} />
                    ))}
                  </Stack>
                </Box>
              </Section>
            )}
          </Collapse>
        </Stack>
      )}

      {view === 'done' && <EstimatesReadout active={active} />}
      {(view === 'inbox' || view === 'someday') && <CompostLink active={active} version={ver} onChanged={reloadAll} />}
      {view === 'today' && <FitsCard active={active} version={ver} />}
    </Stack>
  );

  const moveSheet = <MoveSheet task={moving} projects={projectList} onClose={() => setMoving(null)} run={moveRun} />;

  if (!wide) {
    return (
      <>
        {main}
        <TaskEditorSheet task={sheetTask} projects={projectList} onClose={() => setSheetTask(null)} />
        {moveSheet}
      </>
    );
  }
  return (
    <>
      <Grid gap="lg" align="flex-start">
        <Grid.Col span={7}>{main}</Grid.Col>
        <Grid.Col span={5} pos="sticky" top="calc(var(--app-shell-header-offset, 0px) + 16px)" component="aside" aria-label="Task details">
          {editing ? (
            <Section title="Task">
              <TaskEditor
                key={editing.id}
                task={editing}
                projects={projectList}
                mode="pane"
                onClose={() => setEditTask(null)}
                onSaved={(r) => setEditTask(r)}
              />
            </Section>
          ) : (
            <Text size="sm" c="dimmed" p="md">
              Pick a task to see its details. Press n to add one.
            </Text>
          )}
        </Grid.Col>
      </Grid>
      {moveSheet}
    </>
  );
}

/** Move one task: a day, someday, or another project. Every choice has Undo. */
function MoveSheet({
  task,
  projects,
  onClose,
  run,
}: {
  task: V2Task | null;
  projects: V2Project[];
  onClose: () => void;
  run: (t: V2Task, p: Promise<unknown>, said: string) => Promise<void>;
}) {
  const last = useRef<V2Task | null>(task);
  if (task) last.current = task;
  const t = task ?? last.current;
  const go = (p: () => Promise<unknown>, said: string) => {
    if (!t) return;
    onClose();
    void run(t, p(), said);
  };
  const targets = t ? projects.filter((p) => p.name !== t.project_name) : [];
  const opt = (label: string, icon: ReactNode, onClick: () => void) => (
    <Button key={label} variant="subtle" color="gray" justify="flex-start" fullWidth leftSection={icon} onClick={onClick} size="md">
      {label}
    </Button>
  );
  return (
    <Sheet opened={!!task} onClose={onClose} title={t ? `Move: ${t.title}` : 'Move'} size="sm">
      {t && (
        <Stack gap={2}>
          {opt('Today', <IconSun size={18} stroke={STROKE} />, () => go(() => v2.setDay([t.id], lifeYmd()), 'Moved to today'))}
          {opt('Tomorrow', <IconCalendarPlus size={18} stroke={STROKE} />, () => go(() => v2.setDay([t.id], tomorrow()), 'Moved to tomorrow'))}
          {opt('No day', <IconCalendarOff size={18} stroke={STROKE} />, () => go(() => v2.setDay([t.id], null), 'Day cleared'))}
          {!t.someday && opt('Someday', <IconMoon size={18} stroke={STROKE} />, () => go(() => v2.patchTask(t.id, { someday: true }), 'Parked for someday'))}
          {targets.map((p) =>
            opt(`To ${p.name}`, <IconFolder size={18} stroke={STROKE} />, () => go(() => v2.patchTask(t.id, { project: toProject(p.name) }), `Moved to ${p.name}`)),
          )}
          {targets.length === 0 && projects.length === 0 && (
            <Text size="sm" c="dimmed" px="sm">
              No projects yet.
            </Text>
          )}
        </Stack>
      )}
    </Sheet>
  );
}


