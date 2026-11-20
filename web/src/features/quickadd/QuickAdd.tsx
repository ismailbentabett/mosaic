import { Stack, Switch } from "@mantine/core";
import { MicError } from "../../ui/Mic";
import { Sheet } from "../../ui/Sheet";
import { goesTo } from "./labels";
import { KindChips, PreviewLine, QuickField, QuickFooter, QuickHints, RecentList } from "./Parts";
import { QuickExtras } from "./QuickExtras";
import { KEEP_KEY, writeJson } from "./store";
import { useQuickAdd } from "./useQuickAdd";

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

export function QuickAdd() {
  const q = useQuickAdd();
  const { d, text, kind, type, detected, error, phone, focusField } = q;

  const goes = goesTo(type, {
    project: q.project,
    body: q.body,
    today: q.today,
    projectNames: q.projectNames,
    when: q.when,
    workout: q.ctx.workout,
  });

  const footer = (
    <QuickFooter
      d={d}
      onMicPress={() => {
        if (!d.on) q.base.current = text;
      }}
      onPark={() => void q.park()}
      onSave={() => void q.save()}
      busy={q.busy}
      text={text}
      type={type}
      habit={q.habit}
      phone={phone}
    />
  );

  return (
    <Sheet
      opened={q.opened}
      onClose={q.close}
      title="Quick add"
      size="lg"
      trapFocus={false}
      right={
        <Switch
          size="xs"
          label="Keep open"
          checked={q.keepOpen}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            q.setKeepOpen(v);
            writeJson(KEEP_KEY, v);
          }}
        />
      }
      footer={footer}
    >
      <Stack gap="sm">
        <KindChips
          kind={kind}
          text={text}
          detectedType={detected.type}
          pickKind={q.pickKind}
        />

        <QuickField
          fieldRef={q.field}
          text={text}
          onText={(v) => {
            q.setText(v);
            if (error) q.setError(null);
          }}
          onKey={q.onKey}
          kind={kind}
          type={type}
          onClear={() => {
            q.setText("");
            focusField();
          }}
        />

        <MicError
          error={d.error}
          onRetry={q.startMic}
          onDismiss={() => {
            d.clearError();
            focusField();
          }}
        />

        <PreviewLine
          type={type}
          line={q.line}
          error={error}
          goes={goes}
          remembered={
            kind === "auto" && !!text.trim() && detected.why === "remembered"
          }
        />

        <QuickExtras
          type={type}
          ctx={q.ctx}
          body={q.body}
          habitNames={q.habitNames}
          projectNames={q.projectNames}
          when={q.when}
          setWhen={q.setWhen}
          project={q.project}
          setProject={q.setProject}
          account={q.account}
          setAccount={q.setAccount}
          slot={q.slot}
          setSlot={q.setSlot}
          foodHits={q.foodHits}
          food={q.food}
          setFood={q.setFood}
          suggestion={q.suggestion}
          setText={q.setText}
          focusField={focusField}
          habit={q.habit}
          setHabit={q.setHabit}
        />

        <QuickHints phone={phone} queued={q.queued} online={q.online} />

        {!text.trim() && q.recent.length > 0 && (
          <RecentList
            recent={q.recent}
            onPick={(r) => {
              q.setKind(r.type);
              q.setText(r.type === "habit" ? r.label : "");
              if (r.type === "habit") q.setHabit(r.label);
              focusField();
            }}
          />
        )}
      </Stack>
    </Sheet>
  );
}
