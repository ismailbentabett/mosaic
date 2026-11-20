// Money: overview, records, budgets and savings, shopping, wishlist. Sub-views are nested routes.
import { IconBuildingBank, IconEye, IconEyeOff, IconHourglass, IconLayoutDashboard, IconPigMoney, IconReceipt, IconRefresh, IconShoppingCart } from '@tabler/icons-react';
import { Group } from '@mantine/core';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PLACE_ICON } from '../../app/icons';
import { emit } from '../../store';
import { IconBtn, Page } from '../../ui/Page';
import { useMoneyBlur } from './blur';
import { Accounts } from './Accounts';
import { Budgets } from './Budgets';
import { Overview } from './Overview';
import { Records } from './Records';
import { Shopping } from './Shopping';
import { RouteTabs, type TabDef } from '../../ui/RouteTabs';
import { Wishlist } from './Wishlist';

const BASE = '/life/money';
const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: IconLayoutDashboard },
  { id: 'records', label: 'Records', icon: IconReceipt },
  { id: 'budgets', label: 'Budgets', icon: IconPigMoney },
  { id: 'shopping', label: 'Shopping', icon: IconShoppingCart },
  { id: 'wishlist', label: 'Wishlist', icon: IconHourglass },
  { id: 'accounts', label: 'Accounts', icon: IconBuildingBank },
];

export function MoneyScreen() {
  const [blurred, toggleBlur] = useMoneyBlur();
  return (
    <Page
      title="Money"
      icon={PLACE_ICON.money}
      back="/life"
      wide
      actions={
        <Group gap={4} wrap="nowrap">
          <IconBtn icon={blurred ? IconEyeOff : IconEye} label={blurred ? 'Show amounts' : 'Hide amounts'} variant="subtle" onClick={toggleBlur} />
          <IconBtn icon={IconRefresh} label="Refresh" variant="subtle" onClick={() => emit('money')} />
        </Group>
      }
      toolbar={<RouteTabs base={BASE} tabs={TABS} />}
    >
      <Routes>
        <Route index element={<Overview />} />
        <Route path="records" element={<Records />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="shopping" element={<Shopping />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="*" element={<Navigate to={BASE} replace />} />
      </Routes>
    </Page>
  );
}
