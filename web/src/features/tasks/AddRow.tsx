import { Button, TextInput } from '@mantine/core';
import { useRef, useState, type FormEvent } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { feel } from '../../sound';
import { emit, toast } from '../../store';
import { lifeYmd } from '../../time';
import { act } from '../../ui/data';
import { v2, type TaskInput } from '../../v2';
import { offerMerge } from './triage';
import { dayInline, tomorrow, TYPED_DAY, type TaskView } from './util';

export const ADD_ID = 'plan-add';
export const focusAdd = () => document.querySelector<HTMLInputElement>(`#${ADD_ID}`)?.focus();

/**
 * Inline quick add. The server parses "^project", a day ("fri", "tomorrow", "12 nov", "every mon") and minutes.
 * A typed day beats the view's default day; a typed ^project beats the open project.
 */
export function AddRow({ view, project, onAdded }: { view: TaskView; project: string | null; onAdded: () => void }) {
  const [text, setText] = useState('');
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy.current) return;
    busy.current = true;
    setSaving(true);
    const typedDay = TYPED_DAY.test(` ${t}`);
    const typedProject = t.includes('^');
    const extra: TaskInput =
      view === 'today' && !typedDay
        ? { due_date: lifeYmd() }
        : view === 'upcoming' && !typedDay
          ? { due_date: tomorrow() }
          : view === 'someday'
            ? { someday: true }
            : view === 'projects' && project && !typedProject
              ? { project: project === 'Inbox' ? null : project }
              : {};
    const r = await act(v2.quickAdd(t, extra));
    busy.current = false;
    setSaving(false);
    if (!r) return;
    setText(''); // focus stays in the field: type the next one
    feel('capture');
    if (!offerMerge(r, onAdded)) toast(r.due_date ? `Added for ${dayInline(r.due_date)}` : `Added to ${r.project_name ?? 'Inbox'}`);
    emit('tasks');
  };
  const hint =
    view === 'today'
      ? 'Add task for today'
      : view === 'upcoming'
        ? 'Add task for tomorrow'
        : view === 'someday'
          ? 'Park an idea'
          : view === 'projects' && project
            ? `Add task to ${project}`
            : 'Add task';
  const Plus = PLACE_ICON.add;
  return (
    <form onSubmit={submit}>
      <TextInput
        id={ADD_ID}
        aria-label={hint}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        placeholder={`${hint}  ·  "call bank 20m"`}
        enterKeyHint="enter"
        autoComplete="off"
        maxLength={300}
        aria-busy={saving}
        size="md"
        leftSection={<Plus size={18} stroke={STROKE} />}
        rightSectionWidth={text.trim() ? 84 : undefined}
        rightSection={
          text.trim() ? (
            <Button type="submit" size="compact-sm" loading={saving}>
              Add
            </Button>
          ) : undefined
        }
        data-draft
      />
    </form>
  );
}
