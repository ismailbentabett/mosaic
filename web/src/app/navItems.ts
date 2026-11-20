import { PLACE_ICON, type AppIcon } from './icons';

/** One destination in the app. `match` decides when its nav item is active. */
export type NavItem = {
  id: string;
  label: string;
  path: string;
  icon: AppIcon;
  /** Extra words Spotlight matches. */
  keywords?: string[];
  /** Shortcut hint (number key or g-chord letter). */
  key?: string;
  letter?: string;
};

export const MAIN: NavItem[] = [
  { id: 'chat', label: 'Chat', path: '/chat', icon: PLACE_ICON.ask, key: '1', letter: 'a', keywords: ['home', 'ask', 'mosaic', 'assistant', 'voice', 'upload', 'photo', 'file'] },
  { id: 'today', label: 'Today', path: '/today', icon: PLACE_ICON.today, key: '2', letter: 'h', keywords: ['now', 'start', 'day'] },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: PLACE_ICON.tasks, key: '5', letter: 'p', keywords: ['todo', 'plan', 'inbox', 'projects'] },
  { id: 'calendar', label: 'Calendar', path: '/calendar', icon: PLACE_ICON.calendar, letter: 'c', keywords: ['blocks', 'timeline', 'schedule'] },
];

export const LIFE: NavItem[] = [
  { id: 'money', label: 'Money', path: '/life/money', icon: PLACE_ICON.money, keywords: ['expense', 'spend', 'budget', 'runway', 'shopping', 'wishlist'] },
  { id: 'food', label: 'Food', path: '/life/food', icon: PLACE_ICON.food, keywords: ['kcal', 'calories', 'meal', 'water', 'protein'] },
  { id: 'gym', label: 'Gym', path: '/life/gym', icon: PLACE_ICON.gym, keywords: ['workout', 'sets', 'routine', 'lift'] },
  { id: 'body', label: 'Body', path: '/life/body', icon: PLACE_ICON.body, keywords: ['weight', 'waist', 'screen time', 'sleep'] },
  { id: 'habits', label: 'Habits', path: '/life/habits', icon: PLACE_ICON.habits, keywords: ['check-in', 'routine'] },
  { id: 'people', label: 'People', path: '/life/people', icon: PLACE_ICON.people, keywords: ['family', 'promises', 'waiting', 'capsules', 'lent', 'helped'] },
  { id: 'goals', label: 'Goals', path: '/life/goals', icon: PLACE_ICON.goals, keywords: ['milestone', 'what-if', 'templates'] },
  { id: 'review', label: 'Review', path: '/life/review', icon: PLACE_ICON.review, keywords: ['grade', 'week', 'quarter', 'rating', 'done', 'facts'] },
  { id: 'home', label: 'Home', path: '/life/home', icon: PLACE_ICON.home, keywords: ['habitat', 'chores', 'last done', 'removed', 'restore'] },
  { id: 'car', label: 'Car', path: '/life/car', icon: PLACE_ICON.car, keywords: ['fuel', 'service', 'oil', 'insurance', 'papers', 'km', 'listings'] },
];

export const BRAIN: NavItem[] = [
  { id: 'search', label: 'Search', path: '/brain/search', icon: PLACE_ICON.search, letter: 'b', keywords: ['find', 'everything'] },
  { id: 'notes', label: 'Notes', path: '/brain/notes', icon: PLACE_ICON.notes, keywords: ['vault', 'log', 'markdown', 'conflicts'] },
  { id: 'ideas', label: 'Ideas', path: '/brain/ideas', icon: PLACE_ICON.ideas, keywords: ['park', 'dump', 'questions'] },
  { id: 'cards', label: 'Cards', path: '/brain/cards', icon: PLACE_ICON.cards, keywords: ['flashcards', 'review', 'spaced'] },
  { id: 'documents', label: 'Documents', path: '/brain/documents', icon: PLACE_ICON.documents, keywords: ['files', 'papers', 'expiry'] },
];

export const SETTINGS: NavItem = { id: 'settings', label: 'Settings', path: '/settings', icon: PLACE_ICON.settings, keywords: ['mode', 'theme', 'google', 'status', 'voice', 'sign out'] };

/** Phone bottom bar (the + sits in the middle). Chat is home. */
export const BOTTOM: NavItem[] = [
  MAIN[0],
  MAIN[1],
  { id: 'life', label: 'Life', path: '/life', icon: PLACE_ICON.life, key: '3', letter: 't' },
  { id: 'brain', label: 'Brain', path: '/brain', icon: PLACE_ICON.brain, key: '4' },
];

export const ALL: NavItem[] = [...MAIN, { id: 'life', label: 'Life', path: '/life', icon: PLACE_ICON.life }, ...LIFE, { id: 'brain', label: 'Brain', path: '/brain', icon: PLACE_ICON.brain }, ...BRAIN, SETTINGS];

/** Which top-level section a path belongs to (bottom bar highlight). */
export function sectionOf(path: string): string {
  if (path.startsWith('/life')) return '/life';
  if (path.startsWith('/brain')) return '/brain';
  if (path.startsWith('/today') || path.startsWith('/tasks') || path.startsWith('/calendar')) return '/today';
  if (path.startsWith('/settings')) return '/settings';
  return '/chat';
}

/** Title of the screen at a path (document title fallback, header on phones). */
export function labelOf(path: string): string | null {
  const exact = ALL.find((n) => path === n.path || path.startsWith(n.path + '/'));
  return exact?.label ?? null;
}

/** Name of the most specific screen at a path (document title, error labels): Gym, not Life. */
export function screenOf(path: string): string | null {
  let best: NavItem | null = null;
  for (const n of ALL) if ((path === n.path || path.startsWith(n.path + '/')) && (!best || n.path.length > best.path.length)) best = n;
  return best?.label ?? null;
}
