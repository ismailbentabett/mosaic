import { type Slot, type Workout } from "../../v2";
import { type Topic } from "../../store";
import { parseTask, QUICK_TYPES, type QuickKind, type QuickType } from "./parseQuick";

/* ------------------------------------------------------------------ */
/* Labels and hints                                                    */
/* ------------------------------------------------------------------ */

export const KINDS: QuickKind[] = ["auto", ...QUICK_TYPES];

export const LABEL: Record<QuickKind, string> = {
  auto: "Auto",
  task: "Task",
  expense: "Expense",
  income: "Income",
  food: "Food",
  water: "Water",
  set: "Set",
  weight: "Weight",
  note: "Note",
  idea: "Idea",
  habit: "Habit",
};

export const PLACEHOLDER: Record<QuickKind, string> = {
  auto: "Type anything. “Call Karim tomorrow”, “500 coffee”, “72.4kg”",
  task: "Call Karim tomorrow ^site 25m",
  expense: "500 coffee",
  income: "+1200 salary",
  food: "200g chicken, 2 eggs, pizza 800kcal",
  water: "500ml, 2 glasses, bottle",
  set: "bench 3x8 @60",
  weight: "72.4",
  note: "What happened, what you think",
  idea: "Something for someday",
  habit: "Reading, Stretch…",
};

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
  late: "Late",
};

export type When = "none" | "today" | "tomorrow" | "weekend" | "nextweek" | "someday";
export const WHEN: { v: When; label: string }[] = [
  { v: "today", label: "Today" },
  { v: "tomorrow", label: "Tomorrow" },
  { v: "weekend", label: "Weekend" },
  { v: "nextweek", label: "Next week" },
  { v: "someday", label: "Someday" },
];

export function topicsFor(t: QuickType): Topic[] {
  switch (t) {
    case "task":
    case "idea":
      return ["tasks"];
    case "note":
      return ["notes"];
    case "expense":
    case "income":
      return ["money"];
    case "food":
    case "water":
      return ["food"];
    case "set":
      return ["gym"];
    case "weight":
      return ["body"];
    case "habit":
      return ["habits"];
  }
}

/** Where a save of this type lands, said in the preview line. */
export function goesTo(
  type: QuickType,
  a: {
    project: string;
    body: string;
    today: string;
    projectNames: string[];
    when: When;
    workout: Workout | null;
  }
): string {
  const { project, body, today, projectNames, when } = a;
  return type === "task"
    ? `Goes to ${
        project ||
        parseTask(body, today, projectNames).project ||
        (when === "today"
          ? "Today"
          : when === "someday"
          ? "Someday"
          : "Inbox")
      }`
    : type === "note"
    ? "Goes to today's log"
    : type === "idea"
    ? "Goes to Someday"
    : type === "expense" || type === "income"
    ? "Goes to Money"
    : type === "food" || type === "water"
    ? "Goes to Food"
    : type === "set"
    ? a.workout
      ? `Goes to ${a.workout.name}`
      : "Starts a workout"
    : type === "weight"
    ? "Goes to Body"
    : "Goes to Habits";
}
