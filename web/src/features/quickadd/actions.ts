import type { NavigateFunction } from "react-router-dom";
import { asApiError } from "../../api";
import { writeDraft } from "../../capture";
import { feel } from "../../sound";
import { emit, toast } from "../../store";
import { closeQuickCapture } from "../../ui";
import type { Dictation } from "../../ui/Mic";
import { v2, type FoodItem, type NextSet, type Slot } from "../../v2";
import { announce } from "./announce";
import { topicsFor, type When } from "./labels";
import type { QuickKind, QuickType } from "./parseQuick";
import { Invalid, saveOne } from "./save";
import {
  ACC_KEY,
  OVR_KEY,
  pushRecent,
  readJson,
  RECENT_KEY,
  rememberOverride,
  writeJson,
  type Ctx,
  type Recent,
} from "./store";

/** Everything save and park read or set. */
export type ActionsIn = {
  d: Dictation;
  navigate: NavigateFunction;
  text: string;
  setText: (t: string) => void;
  kind: QuickKind;
  detectedType: QuickType;
  type: QuickType;
  body: string;
  today: string;
  ctx: Ctx;
  project: string;
  when: When;
  account: string;
  slot: Slot;
  food: FoodItem | null;
  setFood: (f: FoodItem | null) => void;
  habit: string;
  setHabit: (h: string) => void;
  suggestion: NextSet | null;
  keepOpen: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  setOverrides: (o: Record<string, QuickType>) => void;
  setRecent: (r: Recent[]) => void;
  focusField: () => void;
};

export function quickActions(s: ActionsIn) {
  const { d, text, setText, kind, type, body, today, project, focusField } = s;
  const { busy, setBusy, setError, keepOpen } = s;

  const save = async (forceType?: QuickType) => {
    if (busy) return;
    const t = text.trim();
    const kindNow: QuickType = forceType ?? type;
    if (!t && !(kindNow === "habit" && s.habit) && !(kindNow === "water")) {
      focusField();
      return;
    }
    setBusy(true);
    setError(null);
    d.abort();
    const before = text;
    try {
      const out = await saveOne({
        type: kindNow,
        body:
          forceType === "note"
            ? t
            : body || (kindNow === "water" ? "water" : ""),
        today,
        ctx: s.ctx,
        project,
        when: s.when,
        account: s.account,
        slot: s.slot,
        food: s.food,
        habit: s.habit,
        suggestion: s.suggestion,
        auto: kind === "auto" && !forceType,
      });
      feel("capture");
      if (kind !== "auto" && kind !== s.detectedType && t) {
        rememberOverride(t, kind as QuickType);
        s.setOverrides(readJson(OVR_KEY, {}));
      }
      if (s.account) writeJson(ACC_KEY, s.account);
      pushRecent({ type: kindNow, label: out.recent, at: Date.now() });
      s.setRecent(readJson<Recent[]>(RECENT_KEY, []));
      emit(...out.topics);
      setText("");
      s.setFood(null);
      s.setHabit("");
      writeDraft({ text: "", type: null, project });

      const restore = () => {
        setText(before);
        writeDraft({
          text: before,
          type: kind === "auto" ? null : kind,
          project,
        });
      };
      announce(out, restore, s.navigate);

      if (keepOpen) focusField();
      else closeQuickCapture();
    } catch (e) {
      if (e instanceof Invalid) {
        feel("error");
        setError(e.message);
        focusField();
      } else if (asApiError(e).code === "queued") {
        // v2 post without a connection: the outbox keeps it and sends it later.
        feel("capture");
        emit(...topicsFor(kindNow));
        setText("");
        writeDraft({ text: "", type: null, project });
        toast("Saved offline. Will sync when online.");
        if (keepOpen) focusField();
        else closeQuickCapture();
      } else {
        feel("error");
        const msg = asApiError(e).message;
        setError(
          msg && msg.length < 140
            ? `Not saved: ${msg}`
            : "Could not save on this device. The text is still here; copy it before you leave."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const park = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    d.abort();
    try {
      const r = await v2.park(t);
      feel("capture");
      emit("tasks");
      setText("");
      writeDraft({ text: "", type: null, project });
      toast(r.message || "Parked. It will come back when you ask for it.", {
        action: {
          label: "Undo",
          run: () => {
            void v2
              .removeTask(r.id)
              .then(() => {
                feel("undo");
                setText(t);
                emit("tasks");
              })
              .catch(() => toast("Could not undo."));
          },
        },
        timeout: 7000,
      });
      if (!keepOpen) closeQuickCapture();
    } catch (e) {
      if (asApiError(e).code === "queued") {
        // Kept on this device and sent when the connection is back. Same ending as a save.
        feel("capture");
        emit("tasks");
        setText("");
        setError(null);
        writeDraft({ text: "", type: null, project });
        toast("Saved offline. Will sync when online.");
        if (keepOpen) focusField();
        else closeQuickCapture();
      } else {
        feel("error");
        setError("Could not park it. The text is still here.");
      }
    } finally {
      setBusy(false);
    }
  };

  return { save, park };
}
