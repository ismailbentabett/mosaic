// Log: pick a meal, then search by grams or type an estimate. Also adds the local dishes.
import { SegmentedControl, SimpleGrid, Stack, Text } from "@mantine/core";
import { ScrollRow } from "../../ui/RouteTabs";
import { useState } from "react";
import * as f from "../../fmt";
import { Section } from "../../ui/Page";
import type { Slot } from "../../v2";
import { FoodPicker, SeedLocalFoods } from "./FoodPicker";
import { SLOT_LABEL, slotChoices, slotNow, useLogged } from "./lib";
import { useFoodDay } from "./Today";

export function Log() {
  const day = useFoodDay();
  const { logged } = useLogged();
  const [slot, setSlot] = useState<Slot>(() => slotNow());
  const d = day.data;
  const slots = slotChoices();
  const inSlot = d?.slots[slot]?.entries ?? [];

  return (
    <SimpleGrid
      cols={{ base: 1, md: 2 }}
      spacing="md"
      verticalSpacing="md"
      style={{ alignItems: "start" }}
    >
      <Section title="Log food">
        <Stack gap="sm">
          <ScrollRow active={slot}>
            <SegmentedControl
              aria-label="Meal"
              value={slot}
              onChange={(v) => setSlot(v as Slot)}
              data={slots.map((s) => ({ value: s, label: SLOT_LABEL[s] }))}
              size="sm"
            />
          </ScrollRow>
          <FoodPicker key={slot} slot={slot} onLogged={logged} />
        </Stack>
      </Section>
      <Stack gap="md">
        <Section
          title={`${SLOT_LABEL[slot]} so far`}
          hint={
            inSlot.length
              ? f.kcal(inSlot.reduce((a, e) => a + e.kcal, 0))
              : undefined
          }
        >
          {inSlot.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nothing logged here today.
            </Text>
          ) : (
            <Stack gap={4}>
              {inSlot.map((e) => (
                <Text key={e.id} size="sm" className="num">
                  {e.name} · {f.kcal(e.kcal)}
                  {e.estimate ? " · estimate" : ""}
                </Text>
              ))}
            </Stack>
          )}
        </Section>
        <Section title="Local dishes">
          <SeedLocalFoods />
        </Section>
      </Stack>
    </SimpleGrid>
  );
}
