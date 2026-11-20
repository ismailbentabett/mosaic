import { useDebouncedValue } from "@mantine/hooks";
import { useEffect, useMemo, useState } from "react";
import { v2, type FoodItem, type NextSet, type Workout } from "../../v2";
import { FOODS_KEY, lastExercise, readJson, type Ctx } from "./store";
import {
  detect,
  parseFood,
  parseSet,
  preview,
  stripPrefix,
  type QuickKind,
  type QuickType,
} from "./parseQuick";

/* ---- what the text is ---- */
export function useDetection(a: {
  opened: boolean;
  text: string;
  kind: QuickKind;
  ctx: Ctx;
  overrides: Record<string, QuickType>;
  project: string;
  today: string;
}) {
  const { opened, text, kind, ctx, overrides, project, today } = a;
  const foods = useMemo(() => readJson<string[]>(FOODS_KEY, []), [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const habitNames = useMemo(() => ctx.habits.map((h) => h.name), [ctx.habits]);
  const projectNames = useMemo(
    () =>
      ctx.projects
        .filter(
          (p) =>
            p.name.toLowerCase() !== "inbox" &&
            !["archived", "done", "dropped"].includes(p.status)
        )
        .map((p) => p.name),
    [ctx.projects]
  );
  const detected = useMemo(
    () =>
      detect(text, {
        activeWorkout: !!ctx.workout,
        foods,
        habits: habitNames,
        overrides,
      }),
    [text, ctx.workout, foods, habitNames, overrides]
  );
  const type: QuickType = kind === "auto" ? detected.type : kind;
  const body = useMemo(() => stripPrefix(text.trim()).rest.trim(), [text]);
  const line = useMemo(
    () =>
      preview(type, text, {
        today,
        projects: projectNames,
        project: project || null,
        habits: habitNames,
        auto: kind === "auto",
      }),
    [type, text, today, projectNames, project, habitNames, kind]
  );
  return { habitNames, projectNames, detected, type, body, line };
}

/* ---- food search while typing a food ---- */
export function useFoodHits(opened: boolean, type: QuickType, body: string) {
  const [foodHits, setFoodHits] = useState<FoodItem[]>([]);
  const foodQuery = type === "food" ? parseFood(body).name : "";
  const [debouncedFood] = useDebouncedValue(foodQuery, 250);
  useEffect(() => {
    if (!opened || type !== "food" || debouncedFood.length < 2) {
      setFoodHits([]);
      return;
    }
    let alive = true;
    v2.foodSearch(debouncedFood, 5)
      .then((r) => alive && setFoodHits(r))
      .catch(() => alive && setFoodHits([]));
    return () => {
      alive = false;
    };
  }, [opened, type, debouncedFood]);
  return foodHits;
}

/* ---- next set hint during a workout ---- */
export function useNextSet(
  opened: boolean,
  type: QuickType,
  body: string,
  workout: Workout | null
) {
  const [suggestion, setSuggestion] = useState<NextSet | null>(null);
  const setExercise =
    type === "set"
      ? parseSet(body)?.exercise || lastExercise(workout) || ""
      : "";
  const [debouncedEx] = useDebouncedValue(setExercise, 300);
  useEffect(() => {
    if (!opened || type !== "set" || !debouncedEx) {
      setSuggestion(null);
      return;
    }
    let alive = true;
    v2.nextSet(debouncedEx)
      .then((n) => alive && setSuggestion(n))
      .catch(() => alive && setSuggestion(null));
    return () => {
      alive = false;
    };
  }, [opened, type, debouncedEx]);
  return suggestion;
}
