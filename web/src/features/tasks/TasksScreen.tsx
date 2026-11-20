// /tasks: primary tabs (Today, Inbox, Upcoming, Projects) drive nested routes; other views sit in a filter menu.
import { ActionIcon, Badge, Menu, Tabs, Text, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCheckbox, IconFilter, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { PLACE_ICON, STROKE } from "../../app/icons";
import { ScrollRow } from "../../ui/RouteTabs";
import * as f from "../../fmt";
import { usePageActive } from "../../hooks";
import { go } from "../../router";
import { feel } from "../../sound";
import { emit, useRefresh } from "../../store";
import { useLoad } from "../../ui/data";
import { Page } from "../../ui/Page";
import { v2, type Counts } from "../../v2";
import { TaskList } from "./TaskList";
import { CompostLink } from "./triage";
import {
  MORE,
  parseTasksPath,
  PRIMARY,
  tasksPath,
  type TaskView,
} from "./util";

const TITLES: Record<TaskView | "compost", string> = {
  today: "Today",
  inbox: "Inbox",
  upcoming: "Upcoming",
  projects: "Projects",
  needs_day: "Needs a day",
  anytime: "Anytime",
  someday: "Someday",
  waiting: "Waiting",
  done: "Done",
  all: "All",
  compost: "Composted",
};

/** Badge count per view, where the server gives one. */
const countOf = (c: Counts | null, v: TaskView | "compost"): number | null => {
  if (!c) return null;
  if (
    v === "today" ||
    v === "inbox" ||
    v === "needs_day" ||
    v === "waiting" ||
    v === "upcoming"
  )
    return c[v];
  return null;
};

export function TasksScreen() {
  const active = usePageActive();
  const wide = useMediaQuery("(min-width: 62em)") ?? false;
  const rest = useParams()["*"] ?? "";
  const { view } = parseTasksPath(rest);
  const counts = useLoad(() => v2.counts(), active, [], { key: "plan-counts" });
  useRefresh("tasks", () => void counts.reload());
  const [picking, setPicking] = useState(false);
  // Leaving a view ends bulk select.
  useEffect(() => setPicking(false), [rest]);
  const onPickingChange = useCallback((on: boolean) => setPicking(on), []);

  const primary = PRIMARY.some((p) => p.id === view) ? view : null;
  const inMore = !primary;
  const canPick = view !== "compost" && view !== "done";

  const toolbar = (
    <ScrollRow active={primary ?? ""}>
      <Tabs
        value={primary}
        onChange={(v) => {
          if (!v) return;
          feel("tab");
          go(tasksPath(v as TaskView));
        }}
        variant="default"
      >
        <Tabs.List
          style={{ flexWrap: "nowrap", width: "max-content", minWidth: "100%" }}
        >
          {PRIMARY.map((p) => {
            const n = countOf(counts.data, p.id);
            return (
              <Tabs.Tab
                key={p.id}
                value={p.id}
                rightSection={
                  n && (p.id === "today" || p.id === "inbox") ? (
                    <Badge
                      size="sm"
                      variant="light"
                      circle={n < 10}
                      className="num"
                    >
                      {f.num(n)}
                    </Badge>
                  ) : undefined
                }
              >
                {p.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs>
    </ScrollRow>
  );

  const actions = (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Tooltip label="More views">
            <ActionIcon
              color="brand"
              variant={inMore ? "light" : "subtle"}
              size="lg"
              aria-label="More views"
            >
              <IconFilter size={20} stroke={STROKE} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Views</Menu.Label>
          {MORE.map((m) => {
            const n = countOf(counts.data, m.id);
            return (
              <Menu.Item
                key={m.id}
                onClick={() => go(tasksPath(m.id))}
                aria-current={view === m.id ? "page" : undefined}
                fw={view === m.id ? 600 : undefined}
                rightSection={
                  n ? (
                    <Text size="xs" c="dimmed" className="num">
                      {f.num(n)}
                    </Text>
                  ) : undefined
                }
              >
                {m.label}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
      {canPick && (
        <Tooltip label={picking ? "Stop selecting" : "Select tasks"}>
          <ActionIcon
            color="brand"
            variant={picking ? "light" : "subtle"}
            size="lg"
            aria-label={picking ? "Stop selecting" : "Select tasks"}
            aria-pressed={picking}
            onClick={() => setPicking((p) => !p)}
          >
            <IconCheckbox size={20} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Refresh">
        <ActionIcon
          variant="subtle"
          size="lg"
          aria-label="Refresh"
          loading={counts.refreshing}
          onClick={() => emit("tasks")}
        >
          <IconRefresh size={20} stroke={STROKE} />
        </ActionIcon>
      </Tooltip>
    </>
  );

  const list = (v: TaskView, project: string | null = null) => (
    <TaskList
      view={v}
      project={project}
      active={active}
      wide={wide}
      picking={picking}
      onPickingChange={onPickingChange}
    />
  );

  return (
    <Page
      title="Tasks"
      subtitle={inMore ? TITLES[view] : undefined}
      icon={PLACE_ICON.tasks}
      wide
      actions={actions}
      toolbar={toolbar}
    >
      <Routes>
        <Route index element={list("today")} />
        <Route path="today" element={<Navigate to="/tasks" replace />} />
        <Route path="upcoming" element={list("upcoming")} />
        <Route path="inbox" element={list("inbox")} />
        <Route path="projects" element={<ProjectRoute render={list} />} />
        <Route path="projects/:id" element={<ProjectRoute render={list} />} />
        <Route path="needs-day" element={list("needs_day")} />
        <Route
          path="needs_day"
          element={<Navigate to="/tasks/needs-day" replace />}
        />
        <Route path="anytime" element={list("anytime")} />
        <Route path="someday" element={list("someday")} />
        <Route path="waiting" element={list("waiting")} />
        <Route path="done" element={list("done")} />
        <Route path="all" element={list("all")} />
        <Route
          path="compost"
          element={
            <CompostLink
              active={active}
              onChanged={() => emit("tasks")}
              startOpen
            />
          }
        />
        <Route path="*" element={<Navigate to="/tasks" replace />} />
      </Routes>
    </Page>
  );
}

/** /tasks/projects and /tasks/projects/:id (the URL-encoded project name). */
function ProjectRoute({
  render,
}: {
  render: (v: TaskView, project: string | null) => ReactNode;
}) {
  // The router already decodes the segment.
  const { id } = useParams();
  const project = id ? id : null;
  return <>{render("projects", project)}</>;
}
