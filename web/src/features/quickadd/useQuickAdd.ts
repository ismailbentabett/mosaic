import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  consumePendingMic,
  DRAFT_EVENT,
  readDraft,
  takeShared,
  VOICE_EVENT,
  writeDraft,
} from "../../capture";
import { feel } from "../../sound";
import { net, useStore } from "../../store";
import { lifeYmd } from "../../time";
import { slotNow } from "../food/lib";
import { closeQuickCapture, ui } from "../../ui";
import { useDictation } from "../../ui/Mic";
import { usePhone } from "../../ui/Sheet";
import type { FoodItem, Slot } from "../../v2";
import { quickActions } from "./actions";
import { useDetection, useFoodHits, useNextSet } from "./hooks";
import { KINDS, type When } from "./labels";
import type { QuickKind, QuickType } from "./parseQuick";
import {
  ACC_KEY,
  ctxCache,
  EMPTY_CTX,
  KEEP_KEY,
  loadCtx,
  OVR_KEY,
  readJson,
  RECENT_KEY,
  type Ctx,
  type Recent,
} from "./store";

/** State, effects and handlers of the quick add sheet. */
export function useQuickAdd() {
  const { capture: opened, captureType, captureText } = useStore(ui);
  const { queued, online } = useStore(net);
  const phone = usePhone();
  const navigate = useNavigate();

  const [text, setText] = useState("");
  const [kind, setKind] = useState<QuickKind>("auto");
  const [project, setProject] = useState("");
  const [when, setWhen] = useState<When>("none");
  const [account, setAccount] = useState<string>(() =>
    readJson<string>(ACC_KEY, "")
  );
  const [slot, setSlot] = useState<Slot>(slotNow);
  const [habit, setHabit] = useState("");
  const [food, setFood] = useState<FoodItem | null>(null);
  const [keepOpen, setKeepOpen] = useState<boolean>(() =>
    readJson<boolean>(KEEP_KEY, false)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Ctx>(ctxCache ?? EMPTY_CTX);
  const [recent, setRecent] = useState<Recent[]>(() =>
    readJson<Recent[]>(RECENT_KEY, [])
  );
  const [overrides, setOverrides] = useState<Record<string, QuickType>>(() =>
    readJson(OVR_KEY, {})
  );

  const field = useRef<HTMLTextAreaElement | null>(null);
  const base = useRef("");
  const today = lifeYmd();

  /* ---- dictation: appends to what was there when recording started ---- */
  const join = (t: string) =>
    (base.current && t ? base.current.replace(/\s*$/, " ") : base.current) + t;
  const d = useDictation({ quiet: true, onText: (t) => setText(join(t)) });

  const focusField = useCallback(() => {
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const startMic = useCallback(() => {
    base.current = field.current?.value ?? "";
    d.start();
  }, [d]);

  /* ---- open: draft + shared text + preset type, context, mic ---- */
  useEffect(() => {
    if (!opened) return;
    const draft = readDraft();
    const shared = captureText || takeShared();
    const t = shared
      ? draft.text
        ? `${draft.text}\n${shared}`
        : shared
      : draft.text;
    setText(t);
    const preset = (captureType ?? draft.type) as QuickKind | null;
    setKind(preset && (KINDS as string[]).includes(preset) ? preset : "auto");
    setProject(draft.project);
    setWhen("none");
    setHabit("");
    setFood(null);
    setError(null);
    setSlot(slotNow());
    setRecent(readJson<Recent[]>(RECENT_KEY, []));
    setOverrides(readJson(OVR_KEY, {}));
    let alive = true;
    loadCtx()
      .then((c) => alive && setCtx(c))
      .catch(() => undefined);
    if (consumePendingMic()) {
      base.current = t;
      d.start();
    } else focusField();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  /* ---- outside writes to the draft (voice sheet) and long-press mic while open ---- */
  useEffect(() => {
    if (!opened) return;
    const onDraft = () => {
      const dr = readDraft();
      setText(dr.text);
      if (dr.type && (KINDS as string[]).includes(dr.type))
        setKind(dr.type as QuickKind);
    };
    const onVoice = () => startMic();
    window.addEventListener(DRAFT_EVENT, onDraft);
    window.addEventListener(VOICE_EVENT, onVoice);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onDraft);
      window.removeEventListener(VOICE_EVENT, onVoice);
    };
  }, [opened, startMic]);

  /* ---- persist the draft on every change ---- */
  useEffect(() => {
    if (!opened) return;
    writeDraft({ text, type: kind === "auto" ? null : kind, project });
  }, [opened, text, kind, project]);

  /* ---- what the text is ---- */
  const { habitNames, projectNames, detected, type, body, line } =
    useDetection({ opened, text, kind, ctx, overrides, project, today });

  /* ---- food search while typing a food ---- */
  const foodHits = useFoodHits(opened, type, body);
  // A picked food stays only while its name is still in the text.
  useEffect(() => {
    if (
      food &&
      !body.toLowerCase().includes(food.name.toLowerCase().split(/[ ,(]/)[0])
    )
      setFood(null);
  }, [body, food]);

  /* ---- next set hint during a workout ---- */
  const suggestion = useNextSet(opened, type, body, ctx.workout);

  /* ---- close ---- */
  const close = () => {
    d.abort();
    closeQuickCapture();
  };

  /* ---- save and park ---- */
  const { save, park } = quickActions({
    d,
    navigate,
    text,
    setText,
    kind,
    detectedType: detected.type,
    type,
    body,
    today,
    ctx,
    project,
    when,
    account,
    slot,
    food,
    setFood,
    habit,
    setHabit,
    suggestion,
    keepOpen,
    busy,
    setBusy,
    setError,
    setOverrides,
    setRecent,
    focusField,
  });

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save(e.shiftKey ? "note" : undefined);
      return;
    }
    // Enter alone saves single-line types; tasks and notes keep Enter for new lines only on phone.
    const counted = kind === "auto" && detected.why.startsWith("count:");
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !phone &&
      (type !== "note" || counted) &&
      !text.includes("\n")
    ) {
      e.preventDefault();
      // Auto never saves money unless the preview line already says Expense / Income.
      const isMoney = type === "expense" || type === "income";
      if (
        kind === "auto" &&
        isMoney &&
        !line?.startsWith(type === "income" ? "Income" : "Expense")
      ) {
        focusField();
        return;
      }
      void save();
    }
  };

  const pickKind = (k: QuickKind) => {
    feel("tap");
    setKind(k);
    setError(null);
    if (k !== "task") setWhen("none");
    focusField();
  };

  return {
    opened,
    queued,
    online,
    phone,
    text,
    setText,
    kind,
    setKind,
    project,
    setProject,
    when,
    setWhen,
    account,
    setAccount,
    slot,
    setSlot,
    habit,
    setHabit,
    food,
    setFood,
    keepOpen,
    setKeepOpen,
    busy,
    error,
    setError,
    ctx,
    recent,
    field,
    base,
    today,
    d,
    focusField,
    startMic,
    habitNames,
    projectNames,
    detected,
    type,
    body,
    line,
    foodHits,
    suggestion,
    close,
    save,
    park,
    onKey,
    pickKind,
  };
}

export type QuickAddState = ReturnType<typeof useQuickAdd>;
