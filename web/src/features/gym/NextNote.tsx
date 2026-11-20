import { Button, Group, TextInput } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { act } from '../../hooks';
import { life } from '../../life';
import { feel } from '../../sound';
import { toast } from '../../store';

/** A short note shown next time this exercise comes up. */
export function NextNote({ exercise }: { exercise: string }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(''), [exercise]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = note.trim();
    if (!n || busy) return;
    setBusy(true);
    const r = await act(life.setNextNote(exercise, n));
    setBusy(false);
    if (r === null) return;
    feel('capture');
    toast(`Note saved · ${exercise}`);
    setNote('');
  };
  return (
    <form onSubmit={save} aria-label={`Note for next time: ${exercise}`}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label={`Note for next time · ${exercise}`}
          placeholder="Add 2.5 kg"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          autoComplete="off"
        />
        <Button type="submit" variant="default" loading={busy} disabled={!note.trim()}>
          Save
        </Button>
      </Group>
    </form>
  );
}
