// Recent: foods logged lately on this device, one tap to log again, and the last 7 days.
import {
  Button,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { ScrollRow } from "../../ui/RouteTabs";
import { useMemo, useState } from "react";
import * as f from "../../fmt";
import { useLoad, usePageActive } from "../../hooks";
import { useRefresh } from "../../store";
import { lifeYmd } from "../../time";
import { Empty, ErrorState, Loading, Section } from "../../ui/Page";
import { v2, type Slot } from "../../v2";
import { daysBefore } from "../money/recordText";
import { Row } from "../money/kit";
import {
  logAgain,
  recentList,
  SLOT_LABEL,
  slotChoices,
  slotNow,
  useLogged,
} from "./lib";
import { useFoodDay } from "./Today";

export function Recent() {
  const day = useFoodDay();
  const { logged, tick } = useLogged();
  const [slot, setSlot] = useState<Slot>(() => slotNow());
  const [busy, setBusy] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => recentList(day.data, 20), [day.data, tick]);

  return (
    <SimpleGrid
      cols={{ base: 1, md: 2 }}
      spacing="md"
      verticalSpacing="md"
      style={{ alignItems: "start" }}
    >
      <Section title="Log again">
        <Stack gap="sm">
          <ScrollRow active={slot}>
            <SegmentedControl
              aria-label="Meal"
              value={slot}
              onChange={(v) => setSlot(v as Slot)}
              data={slotChoices().map((s) => ({
                value: s,
                label: SLOT_LABEL[s],
              }))}
              size="sm"
            />
          </ScrollRow>
          {list.length === 0 ? (
            <Empty title="Nothing logged yet." />
          ) : (
            <Stack gap={0}>
              {list.map((r) => (
                <Row
                  key={r.name}
                  title={r.name}
                  meta={[
                    r.grams ? f.grams(r.grams) : null,
                    r.estimate && !r.protein
                      ? null
                      : `${f.grams(r.protein)} protein`,
                    r.estimate ? "estimate" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  amount={f.kcal(r.kcal)}
                  actions={
                    <Button
                      size="compact-sm"
                      variant="light"
                      loading={busy === r.name}
                      aria-label={`Log ${r.name} again, ${f.kcal(
                        r.kcal
                      )}, to ${SLOT_LABEL[slot].toLowerCase()}`}
                      onClick={async () => {
                        setBusy(r.name);
                        await logAgain(r, slot, logged);
                        setBusy(null);
                      }}
                    >
                      Log
                    </Button>
                  }
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Section>
      <LastDays />
    </SimpleGrid>
  );
}

/** Calories and protein for the last 7 life days, today first. */
function LastDays() {
  const active = usePageActive();
  const today = lifeYmd();
  const days = useLoad(
    () =>
      Promise.all(
        Array.from({ length: 7 }, (_, i) => v2.foodDay(daysBefore(today, i)))
      ),
    active,
    [today],
    { key: `food.week.${today}` }
  );
  useRefresh("food", () => void days.reload());
  if (days.error && !days.data)
    return <ErrorState error={days.error} onRetry={() => void days.reload()} />;
  return (
    <Section title="Last 7 days">
      {!days.data ? (
        <Loading label="Loading the week" lines={3} />
      ) : (
        <Table verticalSpacing={6} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Day</Table.Th>
              <Table.Th ta="right">Calories</Table.Th>
              <Table.Th ta="right">Protein</Table.Th>
              <Table.Th ta="right">Water</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {days.data.map((d) => {
              const empty = d.total.kcal === 0 && d.water_ml === 0;
              return (
                <Table.Tr key={d.day}>
                  <Table.Td>
                    <Text size="sm">{f.day(d.day)}</Text>
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {empty ? f.DASH : f.kcal(d.total.kcal)}
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {empty ? f.DASH : f.grams(d.total.protein)}
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {d.water_ml ? f.ml(d.water_ml) : f.DASH}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
      <Group mt="xs">
        <Text size="xs" c="dimmed">
          Recent foods are kept on this device.
        </Text>
      </Group>
    </Section>
  );
}
