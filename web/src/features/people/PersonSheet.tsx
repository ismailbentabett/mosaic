import { Button, Group, NumberInput, SegmentedControl, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad } from '../../hooks';
import { lifeYmd } from '../../time';
import { Sheet } from '../../ui/Sheet';
import { Hint } from '../review/kit';
import { people, RELATIONS, type Person, type Relation } from './client';

export function PersonSheet({ value, onClose, onSaved }: { value: Person | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const p = value && value !== 'new' ? value : null;
  const key = value === null ? 'none' : p ? p.id : 'new';
  return value === null ? null : <PersonForm key={key} person={p} onClose={onClose} onSaved={onSaved} />;
}

function PersonForm({ person, onClose, onSaved }: { person: Person | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(person?.name ?? '');
  const [relation, setRelation] = useState<Relation>(person?.relation ?? 'family');
  const [birthday, setBirthday] = useState(person?.birthday ?? '');
  const [cadence, setCadence] = useState<number | string>(person?.cadence_days ?? '');
  const [last, setLast] = useState(person?.last_contact ?? '');
  const [note, setNote] = useState(person?.note ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const contacts = useLoad(() => people.contacts(person?.id ?? ''), !!person, [person?.id]);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = {
      name: name.trim(),
      relation,
      birthday: birthday.trim() || null,
      cadence_days: typeof cadence === 'number' && cadence > 0 ? cadence : null,
      last_contact: last || null,
      note: note.trim(),
      phone: phone.trim() || null,
    };
    const r = await act(person ? people.update(person.id, body) : people.add(body), person ? 'Saved' : `Added ${body.name}`);
    setBusy(false);
    if (r) {
      onSaved();
      onClose();
    }
  };
  return (
    <Sheet
      opened
      onClose={onClose}
      title={person ? person.name : 'Add person'}
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            Save
          </Button>
        </Group>
      }
    >
      <Stack gap="sm">
        <TextInput label="Name" value={name} maxLength={80} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <SegmentedControl
          fullWidth
          value={relation}
          onChange={(v) => setRelation(v as Relation)}
          data={RELATIONS.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))}
        />
        <Group grow align="flex-start">
          <TextInput label="Birthday" placeholder="MM-DD" value={birthday} maxLength={10} onChange={(e) => setBirthday(e.currentTarget.value)} />
          <NumberInput label="Reach out every" suffix=" days" min={1} max={365} value={cadence} onChange={setCadence} />
        </Group>
        <TextInput label="Last contact" type="date" value={last} max={lifeYmd()} onChange={(e) => setLast(e.currentTarget.value)} />
        <TextInput
          label="Phone"
          type="tel"
          inputMode="tel"
          placeholder="+213 555 12 34 56"
          value={phone}
          maxLength={25}
          onChange={(e) => setPhone(e.currentTarget.value)}
        />
        <Textarea label="Note" autosize minRows={2} maxLength={500} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Hint>Family and friends only.</Hint>
        {person && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Recent contact
            </Text>
            {contacts.data === null ? (
              <Hint>Loading…</Hint>
            ) : contacts.data.length === 0 ? (
              <Hint>None logged yet.</Hint>
            ) : (
              contacts.data.map((c) => (
                <Text key={c.id} size="sm">
                  <Text span c="dimmed" className="num">
                    {f.day(c.day)}
                  </Text>
                  {c.note ? ` · ${c.note}` : ''}
                </Text>
              ))
            )}
          </Stack>
        )}
      </Stack>
    </Sheet>
  );
}
