import { Select } from "@mantine/core";
import type { FoodItem, NextSet, Slot } from "../../v2";
import { FoodExtras, HabitChips, SetHint, TaskExtras } from "./Extras";
import type { When } from "./labels";
import { matchHabit, type QuickType } from "./parseQuick";
import type { Ctx } from "./store";

/** The type-specific controls under the preview line. */
export function QuickExtras({
  type,
  ctx,
  body,
  habitNames,
  projectNames,
  when,
  setWhen,
  project,
  setProject,
  account,
  setAccount,
  slot,
  setSlot,
  foodHits,
  food,
  setFood,
  suggestion,
  setText,
  focusField,
  habit,
  setHabit,
}: {
  type: QuickType;
  ctx: Ctx;
  body: string;
  habitNames: string[];
  projectNames: string[];
  when: When;
  setWhen: (w: When) => void;
  project: string;
  setProject: (p: string) => void;
  account: string;
  setAccount: (a: string) => void;
  slot: Slot;
  setSlot: (s: Slot) => void;
  foodHits: FoodItem[];
  food: FoodItem | null;
  setFood: (f: FoodItem | null) => void;
  suggestion: NextSet | null;
  setText: (t: string) => void;
  focusField: () => void;
  habit: string;
  setHabit: (h: string) => void;
}) {
  const accountData = ctx.accounts.map((a) => ({
    value: a.id,
    label: `${a.name} · ${a.currency}`,
  }));

  return (
    <>
      {type === "task" && (
        <TaskExtras
          when={when}
          setWhen={setWhen}
          projectNames={projectNames}
          project={project}
          setProject={setProject}
        />
      )}

      {(type === "expense" || type === "income") && accountData.length > 0 && (
        <Select
          size="sm"
          aria-label="Account"
          placeholder="Default account"
          data={accountData}
          value={account || null}
          onChange={(v) => setAccount(v ?? "")}
          clearable
          comboboxProps={{ withinPortal: true, zIndex: 400 }}
        />
      )}

      {type === "food" && (
        <FoodExtras
          slot={slot}
          setSlot={setSlot}
          foodHits={foodHits}
          food={food}
          setFood={setFood}
        />
      )}

      {type === "set" && suggestion && (
        <SetHint
          suggestion={suggestion}
          setText={setText}
          focusField={focusField}
        />
      )}

      {type === "habit" && ctx.habits.length > 0 && (
        <HabitChips
          habits={ctx.habits}
          value={habit || matchHabit(body, habitNames) || ""}
          setHabit={setHabit}
        />
      )}
    </>
  );
}
