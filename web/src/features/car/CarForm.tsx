import { Button, NumberInput, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { toast } from '../../store';
import { FUELS, type Car, type CarInput } from './client';
import { cap, optNum, type NumVal } from './shared';

/* ---------- Car form ---------- */

export function CarForm({ initial, save, onSave }: { initial?: Car; save: string; onSave: (b: CarInput) => Promise<boolean> }) {
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [year, setYear] = useState<NumVal>(initial?.year ?? '');
  const [fuel, setFuel] = useState<string>(initial?.fuel ?? 'petrol');
  const [plate, setPlate] = useState(initial?.plate ?? '');
  const [startKm, setStartKm] = useState<NumVal>(initial?.start_km ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!make.trim() && !model.trim() && !name.trim()) return void toast('Give it a make, a model or a name');
    setBusy(true);
    await onSave({
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      name: name.trim() || undefined,
      year: optNum(year),
      fuel,
      plate: plate.trim() || undefined,
      start_km: optNum(startKm),
    } as CarInput);
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
          <TextInput label="Make" placeholder="Renault" value={make} maxLength={40} onChange={(e) => setMake(e.currentTarget.value)} />
          <TextInput label="Model" placeholder="Clio" value={model} maxLength={40} onChange={(e) => setModel(e.currentTarget.value)} />
          <NumberInput label="Year" placeholder="2014" value={year} onChange={setYear} min={1950} max={2100} hideControls allowDecimal={false} />
          <Select label="Fuel" data={FUELS.map((x) => ({ value: x, label: cap(x === 'gpl' ? 'GPL' : x) }))} value={fuel} onChange={(v) => setFuel(v ?? 'petrol')} allowDeselect={false} />
          <TextInput label="Plate" placeholder="Optional" value={plate} maxLength={20} onChange={(e) => setPlate(e.currentTarget.value)} />
          <NumberInput label="Km when added" placeholder="Optional" value={startKm} onChange={setStartKm} min={0} hideControls allowDecimal={false} thousandSeparator=" " />
        </SimpleGrid>
        <TextInput label="Name" description="Blank = make + model" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
        <Button type="submit" loading={busy} style={{ alignSelf: 'flex-start' }}>
          {save}
        </Button>
      </Stack>
    </form>
  );
}
