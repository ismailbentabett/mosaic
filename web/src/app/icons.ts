// The one icon map. Tabler only, stroke 1.75. Screens import from here, never emoji in UI chrome.
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBarbell,
  IconBrain,
  IconBriefcase,
  IconBulb,
  IconCalendar,
  IconCalendarWeek,
  IconCards,
  IconCar,
  IconCash,
  IconChartBar,
  IconChecklist,
  IconCircleDot,
  IconDroplet,
  IconFileText,
  IconHammer,
  IconHeartbeat,
  IconHome,
  IconHourglass,
  IconInbox,
  IconLayoutGrid,
  IconMicrophone,
  IconMoon,
  IconNote,
  IconNotes,
  IconPlus,
  IconReceipt,
  IconRepeat,
  IconRocket,
  IconScale,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSquareCheck,
  IconSun,
  IconTarget,
  IconPhone,
  IconTool,
  IconToolsKitchen2,
  IconUsers,
  IconWallet,
  type Icon as TablerIcon,
} from '@tabler/icons-react';
import type { AnchorKind, BlockType } from '../blocks';

export type AppIcon = TablerIcon;

/** Default stroke for every icon. */
export const STROKE = 1.75;

/** One icon per place in the app. */
export const PLACE_ICON = {
  today: IconSun,
  tasks: IconChecklist,
  calendar: IconCalendar,
  life: IconLayoutGrid,
  brain: IconBrain,
  money: IconWallet,
  food: IconToolsKitchen2,
  gym: IconBarbell,
  body: IconHeartbeat,
  habits: IconRepeat,
  people: IconUsers,
  goals: IconTarget,
  review: IconChartBar,
  work: IconBriefcase,
  home: IconHome,
  car: IconCar,
  search: IconSearch,
  notes: IconNotes,
  ask: IconSparkles,
  ideas: IconBulb,
  cards: IconCards,
  documents: IconFileText,
  settings: IconSettings,
  inbox: IconInbox,
  add: IconPlus,
  mic: IconMicrophone,
  timer: IconHourglass,
} satisfies Record<string, AppIcon>;

/** Quick add types. */
export const KIND_ICON = {
  auto: IconSparkles,
  task: IconSquareCheck,
  expense: IconReceipt,
  income: IconCash,
  food: IconToolsKitchen2,
  water: IconDroplet,
  set: IconBarbell,
  weight: IconScale,
  note: IconNote,
  idea: IconBulb,
  habit: IconRepeat,
} satisfies Record<string, AppIcon>;

/** Calendar blocks: the title's emoji is stripped for display and replaced by these. */
export const BLOCK_ICON: Record<BlockType, AppIcon> = {
  start: IconRocket,
  focus: IconHammer,
  project: IconTool,
  meet: IconPhone,
  weekend: IconCalendarWeek,
  anchor: IconCircleDot,
  other: IconCircleDot,
};

/** Mantine colour per block type (badges, timeline dots). */
export const BLOCK_COLOR: Record<BlockType, string> = {
  start: 'grape',
  focus: 'cyan',
  project: 'blue',
  meet: 'brand',
  weekend: 'indigo',
  anchor: 'gray',
  other: 'gray',
};

export const ANCHOR_ICON: Record<AnchorKind, AppIcon> = {
  meal: IconToolsKitchen2,
  sleep: IconMoon,
  other: IconCircleDot,
};

export { IconAlertTriangle, IconArrowBackUp };
