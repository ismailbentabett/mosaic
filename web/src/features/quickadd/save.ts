import { asApiError } from "../../api";
import { kcal as fmtKcal, money, plural } from "../../fmt";
import { captureItem } from "../../outbox";
import { type Topic } from "../../store";
import { carApi } from "../car/client";
import { v2, type FoodItem, type NextSet, type Slot } from "../../v2";
import { SLOT_LABEL, type When } from "./labels";
import { bareNumber, lastExercise, rememberFood, whenDate, type Ctx } from "./store";
import {
  countRoute,
  matchHabit,
  parseFood,
  parseMoney,
  parseSet,
  parseTask,
  parseWater,
  parseWeight,
  type QuickType,
} from "./parseQuick";

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export class Invalid extends Error {}

export type Saved = {
  toast: string;
  undo?: () => Promise<unknown>;
  topics: Topic[];
  /** Brain path to open (notes). */
  open?: string;
  /** Saved to the device queue, not the server yet. */
  offlineId?: string;
  recent: string;
};

export type SaveIn = {
  type: QuickType;
  body: string;
  today: string;
  ctx: Ctx;
  project: string;
  when: When;
  account: string;
  slot: Slot;
  food: FoodItem | null;
  habit: string;
  suggestion: NextSet | null;
  /** Auto mode: a count ("5 pages", "123400 km") goes to its own place. */
  auto?: boolean;
};

export async function saveOne(s: SaveIn): Promise<Saved> {
  const { body, today, ctx } = s;
  const short = body.length > 40 ? body.slice(0, 37) + "…" : body;

  switch (s.type) {
    case "task": {
      const names = ctx.projects.map((p) => p.name);
      const p = parseTask(body, today, names);
      const title = p.title || body;
      const project = s.project || p.project || "";
      const due = s.when !== "none" ? whenDate(s.when, today) : p.when;
      const someday = s.when === "someday" || (s.when === "none" && p.someday);
      const plain =
        !project && !due && !someday && !p.minutes && title === body.trim();
      if (plain) {
        const out = await captureItem("task", body);
        if (!out.sent)
          return {
            toast: "Saved. Will sync when online.",
            topics: ["tasks"],
            offlineId: out.clientId,
            recent: title,
          };
        return { toast: "Saved to Inbox", topics: ["tasks"], recent: title };
      }
      const t = await v2.addTask({
        title,
        project: project || null,
        due_date: someday ? null : due,
        someday: someday || undefined,
        est_minutes: p.minutes,
      });
      const where =
        due === today
          ? "Today"
          : project || (someday ? "Someday" : due ? "Upcoming" : "Inbox");
      return {
        toast: `Saved to ${where}`,
        undo: () => v2.removeTask(t.id),
        topics: ["tasks"],
        recent: title,
      };
    }

    case "idea": {
      const t = await v2.addTask({ title: body, someday: true });
      return {
        toast: "Idea saved to Someday",
        undo: () => v2.removeTask(t.id),
        topics: ["tasks"],
        recent: short,
      };
    }

    case "note": {
      const count = s.auto ? countRoute(body) : null;
      if (count?.to === "car_km") {
        try {
          await carApi.logKm(count.km);
          return {
            toast: `Car odometer · ${count.km} km`,
            topics: ["notes"],
            recent: short,
          };
        } catch (e) {
          if (asApiError(e).code === "queued") throw e;
        }
      }
      // Counts that are not the car ("10 emails sent") land in today's log as done.
      const out = await captureItem("note", count ? `Done: ${body}` : body);
      if (!out.sent)
        return {
          toast: "Saved. Will sync when online.",
          topics: ["notes"],
          offlineId: out.clientId,
          recent: short,
        };
      return {
        toast: "Saved to today's log",
        topics: ["notes"],
        open: out.path,
        recent: short,
      };
    }

    case "expense":
    case "income": {
      const m = parseMoney(body);
      if (!m)
        throw new Invalid(
          s.type === "income"
            ? "Add an amount, like “+1200 salary”."
            : "Add an amount, like “500 coffee”."
        );
      const text =
        s.type === "income" && !body.trim().startsWith("+")
          ? "+" + body.trim()
          : body.trim();
      const r = await v2.quickLog(text, s.account || undefined);
      const label = `${r.kind === "income" ? "Income" : "Expense"} ${money(
        r.amount,
        r.currency
      )}`;
      return {
        toast: `${label} saved`,
        undo: () => v2.deleteRecord(r.id),
        topics: ["money"],
        recent: `${label}${m.note ? " · " + m.note : ""}`,
      };
    }

    case "food": {
      const f = parseFood(body);
      if (!f.name && !s.food)
        throw new Invalid("Name the food, like “200g chicken”.");
      const r = s.food
        ? await v2.logFood({
            day: today,
            slot: s.slot,
            food: s.food.id,
            grams: f.grams ?? undefined,
            qty: f.qty ?? undefined,
          })
        : await v2.logFood({
            day: today,
            slot: s.slot,
            name: f.name,
            grams: f.grams ?? undefined,
            qty: f.qty ?? undefined,
            kcal: f.kcal ?? undefined,
            estimate: f.kcal !== null ? true : undefined,
          });
      rememberFood(s.food?.name ?? f.name);
      const label = `${r.name} · ${fmtKcal(r.kcal)}`;
      return {
        toast: `Logged ${label} to ${SLOT_LABEL[s.slot].toLowerCase()}`,
        undo: () => v2.deleteLog(r.id),
        topics: ["food"],
        recent: label,
      };
    }

    case "water": {
      const ml = parseWater(body)?.ml ?? bareNumber(body);
      if (!ml) throw new Invalid("Add an amount, like “500ml”.");
      const r = await v2.water(ml);
      return {
        toast: `Water +${ml} ml · ${r.water_ml} ml today`,
        undo: () => v2.water(-ml),
        topics: ["food"],
        recent: `Water +${ml} ml`,
      };
    }

    case "weight": {
      const kg = parseWeight(body)?.kg ?? bareNumber(body);
      if (!kg) throw new Invalid("Write it like “72.4kg”.");
      const r = await v2.logMetric("weight", kg, "kg");
      return {
        toast: `Weight ${kg} kg saved`,
        undo: () => v2.deleteMetric(r.id),
        topics: ["body"],
        recent: `Weight ${kg} kg`,
      };
    }

    case "set": {
      const p = parseSet(body);
      if (!p) throw new Invalid("Write it like “bench 3x8 @60”.");
      const exercise =
        p.exercise || lastExercise(ctx.workout) || s.suggestion?.exercise || "";
      if (!exercise)
        throw new Invalid("Name the exercise, like “bench 3x8 @60”.");
      const sameAsHint =
        s.suggestion &&
        s.suggestion.exercise.toLowerCase() === exercise.toLowerCase();
      const weight = p.weight ?? (sameAsHint ? s.suggestion!.weight : null);
      const ids: string[] = [];
      for (let i = 0; i < p.sets; i++) {
        const r = await v2.logSet({
          workout_id: ctx.workout?.id,
          exercise,
          reps: p.reps,
          weight: weight ?? undefined,
          type: "working",
        });
        ids.push(r.id);
      }
      const label = `${exercise} ${p.sets > 1 ? `${p.sets}×` : ""}${p.reps}${
        weight !== null ? ` @ ${weight} kg` : ""
      }`;
      return {
        toast: `${plural(p.sets, "set")} logged · ${label}`,
        undo: () => Promise.all(ids.map((id) => v2.deleteSet(id))),
        topics: ["gym"],
        recent: label,
      };
    }

    case "habit": {
      const names = ctx.habits.map((h) => h.name);
      const name = s.habit || matchHabit(body, names) || "";
      const h = ctx.habits.find((x) => x.name === name);
      if (!h) throw new Invalid("Pick a habit below.");
      const before = h.today;
      await v2.checkHabit(h.id, before + 1);
      return {
        toast: `${h.name} checked for today`,
        undo: () => v2.checkHabit(h.id, before),
        topics: ["habits"],
        recent: h.name,
      };
    }
  }
}
