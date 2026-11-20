import { Stack } from '@mantine/core';
import { PLACE_ICON } from '../../app/icons';
import { act } from '../../hooks';
import { Empty, Section } from '../../ui/Page';
import { Hint } from '../review/kit';
import { BuyingPane } from './BuyingPane';
import { CarForm } from './CarForm';
import { carApi } from './client';

/** Overview before a car is saved: the hunt comes first (fund + listings), adding a car second. */
export function NoCarYet() {
  return (
    <Stack gap="md">
      <BuyingPane />
      <Section title="Got a car?" icon={PLACE_ICON.car}>
        <Hint>Add it and fuel, service and papers hang off it.</Hint>
        <CarForm save="Save car" onSave={async (b) => (await act(carApi.addCar(b), 'Car saved')) !== null} />
      </Section>
    </Stack>
  );
}

/** Shown on every tab until a car is saved. */
export function NoCar() {
  return (
    <Stack gap="md">
      <Empty title="No car saved yet" icon={PLACE_ICON.car}>
        Add the car you drive. Fuel, service and papers hang off it. Still looking? The Next car tab tracks the fund and listings.
      </Empty>
      <Section title="Add your car" icon={PLACE_ICON.car}>
        <CarForm save="Save car" onSave={async (b) => (await act(carApi.addCar(b), 'Car saved')) !== null} />
      </Section>
    </Stack>
  );
}
