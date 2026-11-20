// Small helpers shared by the People, Goals, Review, Work and Home screens.
// Route tabs, a one-line form, a meter, and a one-field ask sheet (replaces window.prompt).
import { Button, Group, Progress, Stack, Text, TextInput } from '@mantine/core';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { type AppIcon } from '../../app/icons';
import { toastUndo } from '../../store';
import { act } from '../../ui/data';
import { Sheet } from '../../ui/Sheet';
import { RouteTabs } from '../../ui/RouteTabs';

export type TabDef = { id: string; label: string; icon: AppIcon };

/** First path segment under `base` ('' = index). */
export function useSub(base: string): string {
  const { pathname } = useLocation();
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : '';
  return rest.replace(/^\/+/, '').split('/')[0] ?? '';
}

/** Same tab row as every other screen (fade + active tab in view). */
export function SubTabs({ base, tabs }: { base: string; tabs: TabDef[] }) {
  return <RouteTabs base={base} tabs={tabs} />;
}

/** One input + button. onSubmit returns true to clear the field. */
export function LineForm({
  label,
  placeholder,
  button = 'Add',
  maxLength = 120,
  numeric,
  onSubmit,
}: {
  label: string;
  placeholder?: string;
  button?: string;
  maxLength?: number;
  numeric?: boolean;
  onSubmit: (v: string) => Promise<boolean> | boolean;
}) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = v.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSubmit(t);
    setBusy(false);
    if (ok) setV('');
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput
          aria-label={label}
          placeholder={placeholder ?? label}
          value={v}
          maxLength={maxLength}
          inputMode={numeric ? 'decimal' : undefined}
          onChange={(e) => setV(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button type="submit" variant="light" disabled={!v.trim()} loading={busy}>
          {button}
        </Button>
      </Group>
    </form>
  );
}

/** Thin progress bar with an accessible label. */
export function Meter({ value, max, label, color }: { value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <Progress value={pct} size="sm" radius="xl" color={color} aria-label={label} />;
}

export type AskSpec = {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: ReactNode;
  numeric?: boolean;
  /** Allow saving an empty value (e.g. "blank = clear"). */
  allowEmpty?: boolean;
  type?: 'text' | 'date';
  save: string;
  /** Return true to close the sheet. */
  onSave: (v: string) => Promise<boolean> | boolean;
};

/** A one-field sheet in place of window.prompt. Returns [element, open]. */
export function useAsk(): [ReactNode, (spec: AskSpec) => void] {
  const [spec, setSpec] = useState<AskSpec | null>(null);
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (s: AskSpec) => {
    setV(s.initial ?? '');
    setSpec(s);
  };
  const close = () => setSpec(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!spec || busy) return;
    if (!v.trim() && !spec.allowEmpty) return;
    setBusy(true);
    const ok = await spec.onSave(v.trim());
    setBusy(false);
    if (ok) close();
  };
  const node = (
    <Sheet
      opened={!!spec}
      onClose={close}
      title={spec?.title}
      size="sm"
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!v.trim() && !spec?.allowEmpty}>
            {spec?.save ?? 'Save'}
          </Button>
        </Group>
      }
    >
      {spec && (
        <form onSubmit={(e) => void submit(e)}>
          <Stack gap="xs">
            <TextInput
              label={spec.label}
              placeholder={spec.placeholder}
              value={v}
              type={spec.type ?? 'text'}
              inputMode={spec.numeric ? 'decimal' : undefined}
              onChange={(e) => setV(e.currentTarget.value)}
              data-autofocus
            />
            {spec.hint && (
              <Text size="xs" c="dimmed">
                {spec.hint}
              </Text>
            )}
          </Stack>
        </form>
      )}
    </Sheet>
  );
  return [node, open];
}

/** "3,5" → 3.5; empty or not a number → null. */
export const parseNum = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** ≤0 → today, 1 → tomorrow, else "in N days". */
export const whenText = (days: number | null | undefined): string =>
  days === null || days === undefined ? '' : days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

/** YYYY-MM-DD plus n days (UTC noon, DST-safe). */
export const addDaysYmd = (d: string, n: number): string => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Muted one-line text. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed">
      {children}
    </Text>
  );
}

/** Ids hidden while a delete waits out its undo window. */
export function useHidden() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  return {
    has: (id: string) => ids.has(id),
    hide: (id: string) => setIds((s) => new Set(s).add(id)),
    show: (id: string) =>
      setIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      }),
  };
}

/** Undo instead of confirm: hide now, delete when the 7 s undo window closes. Undo cancels; nothing is lost. */
export function deleteLater(opts: { text: string; hide: () => void; restore: () => void; run: () => Promise<unknown>; after?: () => void }) {
  opts.hide();
  const timer = window.setTimeout(() => {
    void act(opts.run()).then((r) => {
      if (r === null) opts.restore();
      else opts.after?.();
    });
  }, 7200);
  toastUndo(opts.text, () => {
    window.clearTimeout(timer);
    opts.restore();
  });
}
