import { Button, Chip, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState, type FormEvent } from 'react';
import { grades, type Area, type GoalInput, type GoalTemplate, type GoalV2 } from '../../grades';
import { act, useLoad } from '../../hooks';
import { emit, toast } from '../../store';
import { lifeYmd } from '../../time';
import { Sheet } from '../../ui/Sheet';
import { Hint, parseNum } from '../review/kit';

/* ---------- New / edit goal ---------- */

export function GoalSheet({
  opened,
  onClose,
  areas,
  pick: pickIn,
  edit,
  onMade,
}: {
  opened: boolean;
  onClose: () => void;
  areas: Area[];
  pick?: GoalTemplate;
  edit?: GoalV2;
  onMade: () => void;
}) {
  const tpl = useLoad(() => grades.templates(), opened && !edit, [], { key: 'goal-templates' });
  const [name, setName] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [date, setDate] = useState('');
  const [why, setWhy] = useState('');
  const [next, setNext] = useState('');
  const [pick, setPick] = useState<GoalTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const areaKey = edit ? (areas.find((a) => a.id === edit.area_id)?.key ?? null) : null;
    setName(edit?.name ?? '');
    setArea(areaKey);
    setTarget(edit?.target_value !== null && edit?.target_value !== undefined ? String(edit.target_value) : '');
    setUnit(edit?.unit ?? '');
    setDate(edit?.target_date ?? '');
    setWhy(edit?.why ?? '');
    setNext(edit?.next_step ?? '');
    setPick(pickIn ?? null);
    // Reset only when the sheet opens or its subject changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, edit?.id, pickIn?.key]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const tv = target.trim() ? parseNum(target) : null;
    if (target.trim() && tv === null) return void toast('Target must be a number');
    if (!pick && !name.trim()) return void toast('Name the goal');
    setBusy(true);
    let made: unknown = null;
    if (edit) {
      made = await act(
        grades.update(edit.id, {
          name: name.trim(),
          area,
          target_value: tv,
          unit: unit.trim() || null,
          target_date: date || null,
          why: why.trim(),
          next_step: next.trim(),
        }),
        'Goal saved',
      );
    } else if (pick) {
      made = await act(grades.fromTemplate(pick.key, { target_value: tv ?? undefined, target_date: date || undefined } as GoalInput), 'Goal added');
    } else {
      made = await act(
        grades.create({
          name: name.trim(),
          area,
          target_value: tv,
          unit: unit.trim() || null,
          target_date: date || null,
          why: why.trim(),
          next_step: next.trim(),
        }),
        'Goal added',
      );
    }
    setBusy(false);
    if (made) {
      emit('goals');
      onMade();
      onClose();
    }
  };

  const areaData = areas.filter((a) => a.key).map((a) => ({ value: a.key as string, label: a.name }));
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={edit ? 'Edit goal' : 'New goal'}
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {edit ? 'Save' : 'Add goal'}
          </Button>
        </Group>
      }
    >
      <form onSubmit={(e) => void submit(e)}>
        <Stack gap="sm">
          {!edit && (
            <Stack gap={6}>
              <Text size="sm" fw={600}>
                Start from a template (counts itself)
              </Text>
              <Group gap={6}>
                {(tpl.data ?? []).map((t) => (
                  <Chip key={t.key} size="sm" checked={pick?.key === t.key} onChange={() => setPick(pick?.key === t.key ? null : t)}>
                    {t.name}
                  </Chip>
                ))}
              </Group>
            </Stack>
          )}
          {!pick && (
            <>
              <TextInput label="Goal" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} placeholder="Save $3,000 for runway" data-autofocus />
              <Select label="Area" placeholder="No area" data={areaData} value={area} onChange={setArea} clearable comboboxProps={{ withinPortal: true }} />
              <TextInput label="Unit" value={unit} onChange={(e) => setUnit(e.currentTarget.value)} maxLength={20} placeholder="USD, pages, kg" />
              <TextInput label="Why" value={why} onChange={(e) => setWhy(e.currentTarget.value)} maxLength={500} placeholder="One line" />
              <TextInput label={edit ? 'Next step' : 'First step'} value={next} onChange={(e) => setNext(e.currentTarget.value)} maxLength={120} placeholder="Verb first, under 2 minutes" />
            </>
          )}
          {pick && (
            <Hint>
              {pick.why}
              {pick.needs ? ` Needs: ${pick.needs.replace(/_/g, ' ')}.` : ''}
            </Hint>
          )}
          <TextInput
            label={`Target${pick ? ` (${pick.unit})` : ''}`}
            value={target}
            onChange={(e) => setTarget(e.currentTarget.value)}
            inputMode="decimal"
            placeholder={pick?.target_value ? String(pick.target_value) : '3000'}
          />
          <TextInput label="By" type="date" value={date} min={lifeYmd()} onChange={(e) => setDate(e.currentTarget.value)} />
          <Hint>No date = no pace line. A passing thought? Park it in the Inbox from chat; it waits there, no goal needed.</Hint>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </Stack>
      </form>
    </Sheet>
  );
}
