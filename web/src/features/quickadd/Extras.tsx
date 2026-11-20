import { Button, Chip, Group, Select, Stack, Text, UnstyledButton } from "@mantine/core";
import { feel } from "../../sound";
import { ScrollRow } from "../../ui/RouteTabs";
import { EXTRA_SLOTS, SLOTS, type FoodItem, type Habit, type NextSet, type Slot } from "../../v2";
import { SLOT_LABEL, WHEN, type When } from "./labels";

/** Task: when chips and the project picker. */
export function TaskExtras({
  when,
  setWhen,
  projectNames,
  project,
  setProject,
}: {
  when: When;
  setWhen: (w: When) => void;
  projectNames: string[];
  project: string;
  setProject: (p: string) => void;
}) {
  return (
    <Stack gap={8}>
      <ScrollRow active={when}>
        <Chip.Group
          multiple={false}
          value={when}
          onChange={(v) =>
            setWhen((v as When) === when ? "none" : (v as When))
          }
        >
          <Group gap={6} wrap="nowrap">
            {WHEN.map((w) => (
              <Chip
                key={w.v}
                value={w.v}
                size="sm"
                radius="md"
                variant="light"
                onClick={() => {
                  if (when === w.v) setWhen("none");
                }}
              >
                {w.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </ScrollRow>
      <Select
        size="sm"
        placeholder="Inbox"
        aria-label="Project"
        data={projectNames}
        value={project || null}
        onChange={(v) => setProject(v ?? "")}
        clearable
        searchable
        comboboxProps={{ withinPortal: true, zIndex: 400 }}
        nothingFoundMessage="No such project"
      />
    </Stack>
  );
}

/** Food: meal slot chips and matching foods for exact numbers. */
export function FoodExtras({
  slot,
  setSlot,
  foodHits,
  food,
  setFood,
}: {
  slot: Slot;
  setSlot: (s: Slot) => void;
  foodHits: FoodItem[];
  food: FoodItem | null;
  setFood: (f: FoodItem | null) => void;
}) {
  return (
    <Stack gap={8}>
      <ScrollRow active={slot}>
        <Chip.Group
          multiple={false}
          value={slot}
          onChange={(v) => setSlot(v as Slot)}
        >
          <Group gap={6} wrap="nowrap">
            {[...SLOTS, ...EXTRA_SLOTS].map((s) => (
              <Chip key={s} value={s} size="sm" radius="md" variant="light">
                {SLOT_LABEL[s]}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </ScrollRow>
      {foodHits.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={600}>
            Match a food for exact numbers
          </Text>
          {foodHits.map((f) => {
            const on = food?.id === f.id;
            return (
              <UnstyledButton
                key={f.id}
                onClick={() => {
                  feel("tap");
                  setFood(on ? null : f);
                }}
                aria-pressed={on}
                px="sm"
                py={6}
                style={{
                  borderRadius: "var(--mantine-radius-md)",
                  border: `1px solid ${
                    on
                      ? "var(--mantine-primary-color-filled)"
                      : "var(--mantine-color-default-border)"
                  }`,
                  background: on
                    ? "var(--mantine-primary-color-light)"
                    : undefined,
                }}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" truncate>
                    {f.name}
                    {f.brand ? (
                      <Text span c="dimmed" size="xs">
                        {" "}
                        · {f.brand}
                      </Text>
                    ) : null}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    className="num"
                    style={{ flexShrink: 0 }}
                  >
                    {Math.round(f.kcal)} kcal/100g · P{" "}
                    {Math.round(f.protein)}
                  </Text>
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

/** Set: the next-set hint with a Use button. */
export function SetHint({
  suggestion,
  setText,
  focusField,
}: {
  suggestion: NextSet;
  setText: (t: string) => void;
  focusField: () => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed" style={{ flex: 1 }}>
        Next: {suggestion.exercise} {suggestion.reps} reps
        {suggestion.weight !== null ? ` @ ${suggestion.weight} kg` : ""} ·{" "}
        {suggestion.why}
      </Text>
      <Button
        size="compact-sm"
        variant="light"
        onClick={() => {
          setText(
            `${suggestion.exercise} ${
              suggestion.weight !== null ? `${suggestion.weight}kg ` : ""
            }x ${suggestion.reps}`
          );
          focusField();
        }}
      >
        Use
      </Button>
    </Group>
  );
}

/** Habit: one chip per habit, the matched one picked. */
export function HabitChips({
  habits,
  value,
  setHabit,
}: {
  habits: Habit[];
  value: string;
  setHabit: (h: string) => void;
}) {
  return (
    <Chip.Group
      multiple={false}
      value={value}
      onChange={(v) => setHabit(v as string)}
    >
      <Group gap={6}>
        {habits.map((h) => (
          <Chip
            key={h.id}
            value={h.name}
            size="sm"
            radius="md"
            variant="light"
          >
            {h.name}
            {h.today > 0 ? " ✓" : ""}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}
