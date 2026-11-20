// Food: today, log, recent. Sub-views are nested routes under /life/food.
import { IconHistory, IconPlus, IconRefresh, IconSun } from '@tabler/icons-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { emit } from '../../store';
import { IconBtn, Page } from '../../ui/Page';
import { RouteTabs, type TabDef } from '../../ui/RouteTabs';
import { Log } from './Log';
import { Recent } from './Recent';
import { Today } from './Today';

const BASE = '/life/food';
const TABS: TabDef[] = [
  { id: 'today', label: 'Today', icon: IconSun },
  { id: 'log', label: 'Log', icon: IconPlus },
  { id: 'recent', label: 'Recent', icon: IconHistory },
];

export function FoodScreen() {
  return (
    <Page
      title="Food"
      icon={PLACE_ICON.food}
      back="/life"
      wide
      actions={<IconBtn icon={IconRefresh} label="Refresh" variant="subtle" onClick={() => emit('food')} />}
      toolbar={<RouteTabs base={BASE} tabs={TABS} />}
    >
      <Routes>
        <Route index element={<Today />} />
        <Route path="log" element={<Log />} />
        <Route path="recent" element={<Recent />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Page>
  );
}
