// Gym: today and the active workout, history, routines, exercise history.
import { IconBarbell, IconChartLine, IconHistory, IconListDetails } from '@tabler/icons-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { Page } from '../../ui/Page';
import { GymExercise, GymExercises } from './GymExercises';
import { GymHistory } from './GymHistory';
import { GymRoutines } from './GymRoutines';
import { GymToday } from './GymToday';
import { RouteTabs, type TabDef } from '../../ui/RouteTabs';

const BASE = '/life/gym';
const TABS: TabDef[] = [
  { id: '', label: 'Today', icon: IconBarbell },
  { id: 'history', label: 'History', icon: IconHistory },
  { id: 'routines', label: 'Routines', icon: IconListDetails },
  { id: 'exercises', label: 'Exercises', icon: IconChartLine },
];

export function GymScreen() {
  return (
    <Page title="Gym" icon={PLACE_ICON.gym} back="/life" toolbar={<RouteTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<GymToday />} />
        <Route path="history" element={<GymHistory />} />
        <Route path="routines" element={<GymRoutines />} />
        <Route path="exercises" element={<GymExercises />} />
        <Route path="exercises/:ref" element={<GymExercise />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Page>
  );
}
