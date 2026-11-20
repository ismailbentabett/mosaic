// Tool writes the assistant made (tasks added, notes appended, block titles set).
// Every write shows as a chip under the reply, so a change is never hidden.
import { Button, Group, Paper, Stack, Text, VisuallyHidden } from '@mantine/core';
import {
  IconAdjustments,
  IconBarbell,
  IconBell,
  IconCalendar,
  IconFileText,
  IconHeartbeat,
  IconPencil,
  IconRepeat,
  IconSquareCheck,
  IconTarget,
  IconToolsKitchen2,
  IconWallet,
} from '@tabler/icons-react';
import type { ToolStep } from '../../api';
import { STROKE, type AppIcon } from '../../app/icons';
import { go } from '../../router';
import type { Topic } from '../../store';

export type WriteInfo = { icon: AppIcon; topics: Topic[]; path: string | null; place: string | null };

/**
 * Mosaic tools that only read. Everything not on this list counts as a write and gets a chip,
 * so a new tool is never a hidden change (people_touch, promises_keep, day_rate, rescue … all write).
 */
const READS = new Set([
  'afford', 'areas_quiet', 'asks_next', 'body_summary', 'brain_search', 'car_due', 'car_overview',
  'cards_queue', 'closed_days', 'documents_list', 'done_list', 'food_day', 'food_search',
  'free_to_spend', 'get_mode', 'get_today', 'goals_list', 'goals_tree', 'goals_whatif', 'grades_history',
  'grades_week', 'gym_exercises', 'gym_last', 'gym_routines', 'habitat_today', 'habits_list', 'helped_search',
  'inbox_triage', 'last_done', 'lent_list', 'life_snapshot',
  'list_blocks', 'money_read', 'money_summary', 'notes_read', 'notes_recent', 'notes_search', 'people_due',
  'push_log', 'push_status', 'profile_get', 'promises_list', 'questions_open', 'ratings_patterns',
  'recurring_costs', 'removed_recent', 'screentime_summary', 'shop_groups', 'spend_by_who', 'status', 'swap_options',
  'tasks_fits', 'tasks_list', 'waiting_due', 'week_facts',
  // Claude's own tools that do not change anything.
  'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch', 'Task', 'Agent',
]);
/** Tools from other connectors (Google Calendar, Drive …): judged by the verb at the front of the name. */
const OTHER_READ = /^(get|list|search|read|fetch|find|query|describe)_/i;

/** What a tool step changed, or null when it only read something. */
export function writeInfo(rawName: string): WriteInfo | null {
  const own = !rawName.startsWith('mcp__') || rawName.startsWith('mcp__mosaic__');
  const name = rawName.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
  if (own ? READS.has(name) : OTHER_READ.test(name)) return null;
  if (name.startsWith('tasks_') || name === 'recipe_to_shopping') return { icon: IconSquareCheck, topics: ['tasks'], path: '/tasks', place: 'Tasks' };
  if (/^(set_block_task|clear_block_task|upsert_week_bar|upsert_plan_summary)$/.test(name))
    return { icon: IconCalendar, topics: ['blocks'], path: '/today', place: 'Today' };
  if (name === 'set_mode') return { icon: IconAdjustments, topics: ['blocks'], path: '/today', place: 'Today' };
  if (name === 'capture') return { icon: IconFileText, topics: ['notes', 'tasks'], path: '/brain/notes', place: 'Notes' };
  if (name.startsWith('notes_') || name === 'Edit' || name === 'Write') return { icon: IconFileText, topics: ['notes'], path: '/brain/notes', place: 'Notes' };
  if (name.startsWith('money_')) return { icon: IconWallet, topics: ['money'], path: '/life/money', place: 'Money' };
  if (name.startsWith('food_')) return { icon: IconToolsKitchen2, topics: ['food'], path: '/life/food', place: 'Food' };
  if (name.startsWith('gym_')) return { icon: IconBarbell, topics: ['gym'], path: '/life/gym', place: 'Gym' };
  if (name.startsWith('body_')) return { icon: IconHeartbeat, topics: ['body'], path: '/life/body', place: 'Body' };
  if (name.startsWith('habits_')) return { icon: IconRepeat, topics: ['habits'], path: '/life/habits', place: 'Habits' };
  if (name.startsWith('car_')) return { icon: IconPencil, topics: ['car'], path: '/life/car', place: 'Car' };
  if (name === 'rescue') return { icon: IconAdjustments, topics: ['blocks', 'tasks'], path: '/today', place: 'Today' };
  if (name.startsWith('goal_') || name.startsWith('goals_')) return { icon: IconTarget, topics: ['goals'], path: '/life/goals', place: 'Goals' };
  if (name === 'push' || name.startsWith('push_')) return { icon: IconBell, topics: [], path: '/settings/notifications', place: 'Notifications' };
  return { icon: IconPencil, topics: [], path: null, place: null };
}

/** Steps that wrote something. */
export const writesOf = (tools: ToolStep[]) => tools.filter((t) => writeInfo(t.name));

/** Data topics touched by these steps, for emit() after a reply. */
export function writeTopics(tools: ToolStep[]): Topic[] {
  const out = new Set<Topic>();
  for (const t of tools) writeInfo(t.name)?.topics.forEach((x) => out.add(x));
  return [...out];
}

function WriteChip({ step }: { step: ToolStep }) {
  const info = writeInfo(step.name);
  if (!info) return null;
  const Icon = info.icon;
  return (
    <Paper component="li" withBorder radius="md" px="sm" py={6} style={{ listStyle: 'none' }}>
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Icon size={16} stroke={STROKE} aria-hidden="true" style={{ flexShrink: 0 }} />
          <Text size="sm" truncate>
            {step.summary || step.name}
          </Text>
        </Group>
        {info.path && (
          <Button size="compact-sm" variant="subtle" onClick={() => go(info.path!)}>
            Open<VisuallyHidden> {info.place}</VisuallyHidden>
          </Button>
        )}
      </Group>
    </Paper>
  );
}

/** The write chips for one message; renders nothing when the reply only read. */
export function WriteChips({ tools }: { tools: ToolStep[] }) {
  const writes = writesOf(tools);
  if (!writes.length) return null;
  return (
    <Stack component="ul" gap={6} p={0} m={0} aria-label="Changes made">
      {writes.map((t, i) => (
        <WriteChip key={i} step={t} />
      ))}
    </Stack>
  );
}
