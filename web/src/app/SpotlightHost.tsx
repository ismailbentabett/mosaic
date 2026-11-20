import { BRAND } from '../brand';
import { Kbd } from '@mantine/core';
import { Spotlight, spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight';
import { IconBrightness, IconKeyboard, IconMoon, IconSearch, IconSun, IconToggleLeft } from '@tabler/icons-react';
import { useMemo, useRef, useState } from 'react';
import { setTheme } from '../prefs';
import { go } from '../router';
import { openKeys, openMode, openQuickCapture, openSettings, openVoice, type SettingsSection } from '../ui';
import { pushOverlay } from './back';
import { KIND_ICON, PLACE_ICON, STROKE, type AppIcon } from './icons';
import { BRAIN, LIFE, MAIN, SETTINGS, type NavItem } from './navItems';

const ico = (I: AppIcon) => <I size={18} stroke={STROKE} />;

function place(n: NavItem): SpotlightActionData {
  return {
    id: 'go:' + n.path,
    label: n.label,
    keywords: n.keywords,
    leftSection: ico(n.icon),
    rightSection: n.key ? <Kbd size="xs">{n.key}</Kbd> : undefined,
    onClick: () => {
      go(n.path);
    },
  };
}

const ADD: { id: string; label: string; type: string; icon: AppIcon; keywords: string[] }[] = [
  { id: 'task', label: 'Add a task', type: 'task', icon: KIND_ICON.task, keywords: ['todo', 'new'] },
  { id: 'expense', label: 'Log an expense', type: 'expense', icon: KIND_ICON.expense, keywords: ['spent', 'money', 'buy'] },
  { id: 'income', label: 'Log income', type: 'income', icon: KIND_ICON.income, keywords: ['earned', 'paid', 'money'] },
  { id: 'food', label: 'Log food', type: 'food', icon: KIND_ICON.food, keywords: ['ate', 'meal', 'kcal'] },
  { id: 'water', label: 'Log water', type: 'water', icon: KIND_ICON.water, keywords: ['drink', 'ml'] },
  { id: 'set', label: 'Log a gym set', type: 'set', icon: KIND_ICON.set, keywords: ['reps', 'workout'] },
  { id: 'weight', label: 'Log weight', type: 'weight', icon: KIND_ICON.weight, keywords: ['kg', 'body'] },
  { id: 'note', label: 'Write a note', type: 'note', icon: KIND_ICON.note, keywords: ['log', 'journal'] },
  { id: 'idea', label: 'Park an idea', type: 'idea', icon: KIND_ICON.idea, keywords: ['later', 'question'] },
  { id: 'habit', label: 'Check in a habit', type: 'habit', icon: KIND_ICON.habit, keywords: ['done', 'routine'] },
];

const SECTIONS: { id: SettingsSection; label: string; keywords: string[] }[] = [
  { id: 'look', label: 'Settings: Look', keywords: ['theme', 'dark', 'light', 'motion'] },
  { id: 'sound', label: 'Settings: Sound and haptics', keywords: ['feel', 'vibration', 'noise'] },
  { id: 'voice', label: 'Settings: Voice', keywords: ['language', 'speech', 'mic'] },
  { id: 'google', label: 'Settings: Google', keywords: ['calendar', 'sheet', 'connect'] },
  { id: 'status', label: 'Settings: Status', keywords: ['health', 'server', 'sync'] },
  { id: 'app', label: 'Settings: App', keywords: ['sign out', 'version', 'install', 'cache'] },
  { id: 'links', label: 'Settings: Links', keywords: ['tasks', 'pushes', 'website'] },
];

/** Ctrl/⌘K: every place, every quick add type, settings and a brain search for whatever was typed. */
export function SpotlightHost() {
  const [query, setQuery] = useState('');
  const release = useRef<(() => void) | null>(null);

  const actions = useMemo<(SpotlightActionData | SpotlightActionGroupData)[]>(() => {
    const groups: SpotlightActionGroupData[] = [
      { group: 'Go to', actions: [...MAIN, ...LIFE, ...BRAIN, SETTINGS].map(place) },
      {
        group: 'Add',
        actions: ADD.map((a) => ({
          id: 'add:' + a.id,
          label: a.label,
          keywords: a.keywords,
          leftSection: ico(a.icon),
          onClick: () => openQuickCapture(a.type),
        })),
      },
      {
        group: 'Do',
        actions: [
          { id: 'voice', label: `Talk to ${BRAND.assistant}`, keywords: ['speak', 'mic', 'talk', 'voice'], leftSection: ico(PLACE_ICON.mic), rightSection: <Kbd size="xs">v</Kbd>, onClick: openVoice },
          { id: 'mode', label: 'Change mode', keywords: ['normal', 'zero', 'family'], leftSection: <IconToggleLeft size={18} stroke={STROKE} />, onClick: openMode },
          { id: 'keys', label: 'Keyboard shortcuts', keywords: ['keys', 'hotkeys'], leftSection: <IconKeyboard size={18} stroke={STROKE} />, rightSection: <Kbd size="xs">?</Kbd>, onClick: openKeys },
          { id: 'theme-light', label: 'Theme: Light', keywords: ['bright', 'day'], leftSection: <IconSun size={18} stroke={STROKE} />, onClick: () => setTheme('light') },
          { id: 'theme-dark', label: 'Theme: Dark', keywords: ['night'], leftSection: <IconMoon size={18} stroke={STROKE} />, onClick: () => setTheme('dark') },
          { id: 'theme-system', label: 'Theme: Match system', keywords: ['auto'], leftSection: <IconBrightness size={18} stroke={STROKE} />, onClick: () => setTheme('system') },
          ...SECTIONS.map((s) => ({ id: 'set:' + s.id, label: s.label, keywords: s.keywords, leftSection: ico(PLACE_ICON.settings), onClick: () => openSettings(s.id) })),
        ],
      },
    ];
    const q = query.trim();
    if (!q) return groups;
    const search: SpotlightActionGroupData = {
      group: 'Search',
      actions: [
        {
          id: 'search-brain',
          label: `Search the brain for “${q}”`,
          leftSection: <IconSearch size={18} stroke={STROKE} />,
          // Always shown: the filter matches on keywords, so give it the query itself.
          keywords: [q],
          onClick: () => go(`/brain/search?q=${encodeURIComponent(q)}`),
        },
        {
          id: 'ask-assistant',
          label: `Ask about “${q}”`,
          leftSection: ico(PLACE_ICON.ask),
          keywords: [q],
          onClick: () => go(`/chat?q=${encodeURIComponent(q)}`),
        },
        {
          id: 'add-it',
          label: `Quick add “${q}”`,
          leftSection: ico(PLACE_ICON.add),
          keywords: [q],
          onClick: () => openQuickCapture(null, q),
        },
      ],
    };
    return [...groups, search];
  }, [query]);

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      shortcut={['mod + K']}
      limit={14}
      highlightQuery
      nothingFound="Nothing matches"
      scrollable
      maxHeight={440}
      radius="lg"
      onSpotlightOpen={() => {
        release.current?.();
        release.current = pushOverlay(() => spotlight.close());
      }}
      onSpotlightClose={() => {
        release.current?.();
        release.current = null;
      }}
      searchProps={{
        leftSection: <IconSearch size={18} stroke={STROKE} />,
        placeholder: 'Go to, add, or search…',
      }}
    />
  );
}

export const openSpotlight = () => spotlight.open();
