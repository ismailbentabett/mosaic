// Review: week facts + one change, day ratings + patterns, done-log, quarter, week facts, closed days.
// Plain counts against your own targets. No letters, no scores; Saturday rests.
import { IconCalendarOff, IconCheck, IconFileText, IconListCheck, IconMoodSmile } from '@tabler/icons-react';
import { Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { Page } from '../../ui/Page';
import { ClosedPane } from './ClosedPane';
import { DaysPane } from './DaysPane';
import { DonePane } from './DonePane';
import { FactsPane } from './FactsPane';
import { SubTabs, type TabDef } from './kit';
import { QuarterPane } from './QuarterPane';
import { WeekPane } from './WeekPane';

const BASE = '/life/review';
const TABS: TabDef[] = [
  { id: 'week', label: 'Week', icon: PLACE_ICON.review },
  { id: 'days', label: 'Days', icon: IconMoodSmile },
  { id: 'done', label: 'Done', icon: IconListCheck },
  { id: 'quarter', label: 'Quarter', icon: IconFileText },
  { id: 'facts', label: 'Facts', icon: IconCheck },
  { id: 'closed', label: 'Closed days', icon: IconCalendarOff },
];

export function ReviewScreen() {
  return (
    <Page title="Review" icon={PLACE_ICON.review} back="/life" toolbar={<SubTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<WeekPane />} />
        <Route path="week" element={<WeekPane />} />
        <Route path="days" element={<DaysPane />} />
        <Route path="done" element={<DonePane />} />
        <Route path="quarter" element={<QuarterPane />} />
        <Route path="facts" element={<FactsPane />} />
        <Route path="closed" element={<ClosedPane />} />
        <Route path="*" element={<WeekPane />} />
      </Routes>
    </Page>
  );
}
