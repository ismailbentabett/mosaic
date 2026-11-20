// People: who is due a call, promises, waiting-for checks, occasions, time capsules, lent and helped.
// Deletes wait out a 7 s undo window.
import { IconArrowsExchange, IconCake, IconHeartHandshake, IconHourglass, IconMailbox } from '@tabler/icons-react';
import { Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { Page } from '../../ui/Page';
import { SubTabs, type TabDef } from '../review/kit';
import { CapsulesPane } from './CapsulesPane';
import { DuePane } from './DuePane';
import { LentHelpedPane } from './LentPane';
import { OccasionsPane } from './OccasionsPane';
import { PromisesPane } from './PromisesPane';
import { WaitingPane } from './WaitingPane';

export { parseHelped } from './HelpedSection';

const BASE = '/life/people';
const TABS: TabDef[] = [
  { id: 'due', label: 'Due', icon: PLACE_ICON.people },
  { id: 'promises', label: 'Promises', icon: IconHeartHandshake },
  { id: 'waiting', label: 'Waiting', icon: IconHourglass },
  { id: 'occasions', label: 'Occasions', icon: IconCake },
  { id: 'capsules', label: 'Capsules', icon: IconMailbox },
  { id: 'lent', label: 'Lent & Helped', icon: IconArrowsExchange },
];

export function PeopleScreen() {
  return (
    <Page title="People" icon={PLACE_ICON.people} back="/life" toolbar={<SubTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<DuePane />} />
        <Route path="due" element={<DuePane />} />
        <Route path="promises" element={<PromisesPane />} />
        <Route path="waiting" element={<WaitingPane />} />
        <Route path="occasions" element={<OccasionsPane />} />
        <Route path="capsules" element={<CapsulesPane />} />
        <Route path="lent" element={<LentHelpedPane />} />
        <Route path="*" element={<DuePane />} />
      </Routes>
    </Page>
  );
}
