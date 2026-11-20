import { Button } from '@mantine/core';
import { lazy, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { takeShared } from '../capture';
import { go } from '../router';
import { openQuickCapture } from '../ui';
import { DEMO, MOCK } from '../api';
import { Empty, Page } from '../ui/Page';
import { PLACE_ICON } from './icons';

// One lazy chunk per feature. Each file exports a named screen.
const UiGallery = lazy(() => import('../features/dev/UiGallery').then((m) => ({ default: m.UiGallery })));
const loadToday = () => import('../features/today/Today');
const Today = lazy(() => loadToday().then((m) => ({ default: m.Today })));
const loadTasksScreen = () => import('../features/tasks/TasksScreen');
const TasksScreen = lazy(() => loadTasksScreen().then((m) => ({ default: m.TasksScreen })));
const loadCalendarScreen = () => import('../features/calendar/CalendarScreen');
const CalendarScreen = lazy(() => loadCalendarScreen().then((m) => ({ default: m.CalendarScreen })));

const loadLifeHub = () => import('../features/life/LifeHub');
const LifeHub = lazy(() => loadLifeHub().then((m) => ({ default: m.LifeHub })));
const loadMoneyScreen = () => import('../features/money/MoneyScreen');
const MoneyScreen = lazy(() => loadMoneyScreen().then((m) => ({ default: m.MoneyScreen })));
const loadFoodScreen = () => import('../features/food/FoodScreen');
const FoodScreen = lazy(() => loadFoodScreen().then((m) => ({ default: m.FoodScreen })));
const loadGymScreen = () => import('../features/gym/GymScreen');
const GymScreen = lazy(() => loadGymScreen().then((m) => ({ default: m.GymScreen })));
const loadBodyScreen = () => import('../features/body/BodyScreen');
const BodyScreen = lazy(() => loadBodyScreen().then((m) => ({ default: m.BodyScreen })));
const loadHabitsScreen = () => import('../features/habits/HabitsScreen');
const HabitsScreen = lazy(() => loadHabitsScreen().then((m) => ({ default: m.HabitsScreen })));
const loadPeopleScreen = () => import('../features/people/PeopleScreen');
const PeopleScreen = lazy(() => loadPeopleScreen().then((m) => ({ default: m.PeopleScreen })));
const loadGoalsScreen = () => import('../features/goals/GoalsScreen');
const GoalsScreen = lazy(() => loadGoalsScreen().then((m) => ({ default: m.GoalsScreen })));
const loadReviewScreen = () => import('../features/review/ReviewScreen');
const ReviewScreen = lazy(() => loadReviewScreen().then((m) => ({ default: m.ReviewScreen })));
const loadHomeScreen = () => import('../features/home/HomeScreen');
const HomeScreen = lazy(() => loadHomeScreen().then((m) => ({ default: m.HomeScreen })));
const loadCarScreen = () => import('../features/car/CarScreen');
const CarScreen = lazy(() => loadCarScreen().then((m) => ({ default: m.CarScreen })));

const loadBrainHub = () => import('../features/brain/BrainHub');
const BrainHub = lazy(() => loadBrainHub().then((m) => ({ default: m.BrainHub })));
const loadSearchScreen = () => import('../features/brain/SearchScreen');
const SearchScreen = lazy(() => loadSearchScreen().then((m) => ({ default: m.SearchScreen })));
const loadNotesScreen = () => import('../features/brain/NotesScreen');
const NotesScreen = lazy(() => loadNotesScreen().then((m) => ({ default: m.NotesScreen })));
const loadAskScreen = () => import('../features/brain/AskScreen');
const AskScreen = lazy(() => loadAskScreen().then((m) => ({ default: m.AskScreen })));
const loadIdeasScreen = () => import('../features/brain/IdeasScreen');
const IdeasScreen = lazy(() => loadIdeasScreen().then((m) => ({ default: m.IdeasScreen })));
const loadCardsScreen = () => import('../features/brain/CardsScreen');
const CardsScreen = lazy(() => loadCardsScreen().then((m) => ({ default: m.CardsScreen })));
const loadDocumentsScreen = () => import('../features/brain/DocumentsScreen');
const DocumentsScreen = lazy(() => loadDocumentsScreen().then((m) => ({ default: m.DocumentsScreen })));

const loadSettingsScreen = () => import('../features/settings/SettingsScreen');
const SettingsScreen = lazy(() => loadSettingsScreen().then((m) => ({ default: m.SettingsScreen })));
const loadNotificationsScreen = () => import('../features/settings/NotificationsScreen');
const NotificationsScreen = lazy(() => loadNotificationsScreen().then((m) => ({ default: m.NotificationsScreen })));

/** Path prefix -> chunk loader, longest first. */
const PREFETCH: [string, () => Promise<unknown>][] = [
  ['/settings/notifications', loadNotificationsScreen],
  ['/brain/documents', loadDocumentsScreen],
  ['/brain/search', loadSearchScreen],
  ['/life/habits', loadHabitsScreen],
  ['/life/people', loadPeopleScreen],
  ['/life/review', loadReviewScreen],
  ['/brain/notes', loadNotesScreen],
  ['/brain/ideas', loadIdeasScreen],
  ['/brain/cards', loadCardsScreen],
  ['/life/money', loadMoneyScreen],
  ['/life/goals', loadGoalsScreen],
  ['/life/food', loadFoodScreen],
  ['/life/body', loadBodyScreen],
  ['/life/home', loadHomeScreen],
  ['/calendar', loadCalendarScreen],
  ['/life/gym', loadGymScreen],
  ['/life/car', loadCarScreen],
  ['/settings', loadSettingsScreen],
  ['/today', loadToday],
  ['/tasks', loadTasksScreen],
  ['/chat', loadAskScreen],
  ['/life', loadLifeHub],
];
const fetched = new Set<string>();
/** Start loading a screen's chunk before the tap lands (hover, focus, touch start). */
export function prefetchRoute(path: string) {
  const hit = PREFETCH.find(([p]) => path === p || path.startsWith(p + '/'));
  if (!hit || fetched.has(hit[0])) return;
  fetched.add(hit[0]);
  void hit[1]().catch(() => fetched.delete(hit[0]));
}

const TASK_VIEWS = ['today', 'upcoming', 'inbox', 'anytime', 'someday', 'waiting', 'done', 'all'];
const LIFE_SEGS = ['money', 'food', 'gym', 'body', 'habits'];

/** Where an old `/plan?s=…&p=…` link lives now. */
export function planTarget(p: URLSearchParams): string {
  const s = p.get('s') ?? 'today';
  if (s === 'today') return '/tasks';
  if (TASK_VIEWS.includes(s)) return `/tasks/${s}`;
  if (s === 'needs_day' || s === 'needs-day') return '/tasks/needs-day';
  if (s === 'projects') {
    const proj = p.get('p');
    return proj ? `/tasks/projects/${encodeURIComponent(proj)}` : '/tasks/projects';
  }
  const map: Record<string, string> = {
    ideas: '/brain/ideas',
    habits: '/life/habits',
    goals: '/life/goals',
    grades: '/life/review',
    docs: '/brain/documents',
    documents: '/brain/documents',
  };
  return map[s] ?? '/tasks';
}

/** Where an old `/track?s=…` link lives now. */
export function trackTarget(p: URLSearchParams): string {
  const s = p.get('s') ?? p.get('seg') ?? 'money';
  return LIFE_SEGS.includes(s) ? `/life/${s}` : '/life';
}

/** Where an old `/brain?s=…` or `/brain?q=…` link lives now; null = stay on the hub. */
export function brainTarget(p: URLSearchParams): string | null {
  const q = p.get('q') ?? p.get('focus');
  if (q !== null) return q ? `/brain/search?q=${encodeURIComponent(q)}` : '/brain/search';
  const s = p.get('s');
  if (!s) return null;
  const map: Record<string, string> = {
    done: '/life/review/done',
    cards: '/brain/cards',
    dump: '/brain/ideas/dump',
    questions: '/brain/ideas/questions',
    screen: '/life/body/screen',
    life: '/life',
    search: '/brain/search',
    notes: '/brain/notes',
    ideas: '/brain/ideas',
    docs: '/brain/documents',
    documents: '/brain/documents',
  };
  return map[s] ?? null;
}

/** Where an old `/notes…`, `/claude…` or `/jarvis` link lives now. */
export function notesTarget(pathname: string, search: string): string {
  const rest = pathname.replace(/^\/notes/, '');
  return `/brain/notes${rest}${search}`;
}

function Redirect({ to }: { to: (loc: { pathname: string; search: string; params: URLSearchParams }) => string }) {
  const loc = useLocation();
  return <Navigate replace to={to({ pathname: loc.pathname, search: loc.search, params: new URLSearchParams(loc.search) })} />;
}

function BrainEntry() {
  const loc = useLocation();
  const target = brainTarget(new URLSearchParams(loc.search));
  if (target) return <Navigate replace to={target} />;
  return <BrainHub />;
}

/** Shared text and old `#/capture`: quick add opens with the text over the chat. Shared photos and files go to the chat (native.ts). */
function CaptureEntry() {
  useEffect(() => {
    const text = takeShared();
    openQuickCapture(null, text);
  }, []);
  return <Navigate replace to="/chat" />;
}

function NotFound(): ReactNode {
  return (
    <Page title="Not here">
      <Empty
        title="This page does not exist"
        icon={PLACE_ICON.ask}
        action={
          <Button variant="light" onClick={() => go('/chat')}>
            Go to Chat
          </Button>
        }
      >
        The link may be old. Everything starts in Chat. Today, Life and Brain hold what it fills.
      </Empty>
    </Page>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/chat" />} />
      <Route path="/home" element={<Navigate replace to="/chat" />} />
      <Route path="/chat/*" element={<AskScreen />} />
      <Route path="/today/*" element={<Today />} />
      {MOCK && !DEMO && <Route path="/dev/ui" element={<UiGallery />} />}

      <Route path="/tasks/*" element={<TasksScreen />} />
      <Route path="/calendar/*" element={<CalendarScreen />} />

      <Route path="/life" element={<LifeHub />} />
      <Route path="/life/money/*" element={<MoneyScreen />} />
      <Route path="/life/food/*" element={<FoodScreen />} />
      <Route path="/life/gym/*" element={<GymScreen />} />
      <Route path="/life/body/*" element={<BodyScreen />} />
      <Route path="/life/habits/*" element={<HabitsScreen />} />
      <Route path="/life/people/*" element={<PeopleScreen />} />
      <Route path="/life/goals/*" element={<GoalsScreen />} />
      <Route path="/life/review/*" element={<ReviewScreen />} />
      <Route path="/life/home/*" element={<HomeScreen />} />
      <Route path="/life/car/*" element={<CarScreen />} />

      <Route path="/brain" element={<BrainEntry />} />
      <Route path="/brain/search" element={<SearchScreen />} />
      <Route path="/brain/notes/*" element={<NotesScreen />} />
      <Route path="/brain/ask/*" element={<Redirect to={({ pathname, search }) => `/chat${pathname.slice('/brain/ask'.length)}${search}`} />} />
      <Route path="/brain/ideas/*" element={<IdeasScreen />} />
      <Route path="/brain/cards" element={<CardsScreen />} />
      <Route path="/brain/documents" element={<DocumentsScreen />} />

      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/settings/notifications" element={<NotificationsScreen />} />

      {/* Old links (deep links, notifications, bookmarks, the nightly push). */}
      <Route path="/plan" element={<Redirect to={({ params }) => planTarget(params)} />} />
      <Route path="/track" element={<Redirect to={({ params }) => trackTarget(params)} />} />
      <Route path="/notes/*" element={<Redirect to={({ pathname, search }) => notesTarget(pathname, search)} />} />
      <Route path="/claude" element={<Redirect to={({ search }) => `/chat${search}`} />} />
      <Route path="/jarvis" element={<Navigate replace to="/chat?voice=1" />} />
      <Route path="/capture" element={<CaptureEntry />} />
      <Route path="/life/*" element={<Redirect to={() => '/life'} />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
