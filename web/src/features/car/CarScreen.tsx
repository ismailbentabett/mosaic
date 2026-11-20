// Car: km, fuel, service, papers and the next-car hunt (fund + listings).
// Amounts also land in Money (Transport). Past dates read as "past", never as a miss.
import { IconFileCertificate, IconGasStation, IconSearch, IconTool } from '@tabler/icons-react';
import { Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { Page } from '../../ui/Page';
import { SubTabs, type TabDef } from '../review/kit';
import { BuyingPane } from './BuyingPane';
import { FuelPane } from './FuelPane';
import { OverviewPane } from './OverviewPane';
import { PapersPane } from './PapersPane';
import { ServicePane } from './ServicePane';
import { BASE } from './shared';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: PLACE_ICON.car },
  { id: 'fuel', label: 'Fuel', icon: IconGasStation },
  { id: 'service', label: 'Service', icon: IconTool },
  { id: 'papers', label: 'Papers', icon: IconFileCertificate },
  { id: 'buying', label: 'Next car', icon: IconSearch },
];

export function CarScreen() {
  return (
    <Page title="Car" icon={PLACE_ICON.car} back="/life" toolbar={<SubTabs base={BASE} tabs={TABS} />}>
      <Routes>
        <Route index element={<OverviewPane />} />
        <Route path="overview" element={<OverviewPane />} />
        <Route path="fuel" element={<FuelPane />} />
        <Route path="service" element={<ServicePane />} />
        <Route path="papers" element={<PapersPane />} />
        <Route path="buying" element={<BuyingPane />} />
        <Route path="*" element={<OverviewPane />} />
      </Routes>
    </Page>
  );
}
