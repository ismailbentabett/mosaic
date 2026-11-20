// Goals: the tree by area (pace line, next step, floor/stretch, an Options menu (shrink, new date, pre-mortem), pause, finish),
// milestones, a savings what-if, templates and links to habits/projects.
import { IconCalculator, IconFlag, IconLink, IconTemplate } from '@tabler/icons-react';
import { Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { Page } from '../../ui/Page';
import { SubTabs, type TabDef } from '../review/kit';
import { LinksPane } from './LinksPane';
import { MilestonesPane } from './Milestones';
import { BASE } from './shared';
import { TemplatesPane } from './TemplatesPane';
import { TreePane } from './TreePane';
import { WhatIfPane } from './WhatIf';

const TABS: TabDef[] = [
  { id: 'tree', label: 'Goals', icon: PLACE_ICON.goals },
  { id: 'milestones', label: 'Milestones', icon: IconFlag },
  { id: 'whatif', label: 'What if', icon: IconCalculator },
  { id: 'templates', label: 'Templates', icon: IconTemplate },
  { id: 'links', label: 'Links', icon: IconLink },
];

export function GoalsScreen() {
  return (
    <Page title="Goals" icon={PLACE_ICON.goals} back="/life" toolbar={<SubTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<TreePane />} />
        <Route path="tree" element={<TreePane />} />
        <Route path="milestones" element={<MilestonesPane />} />
        <Route path="whatif" element={<WhatIfPane />} />
        <Route path="templates" element={<TemplatesPane />} />
        <Route path="links" element={<LinksPane />} />
        <Route path="*" element={<TreePane />} />
      </Routes>
    </Page>
  );
}
