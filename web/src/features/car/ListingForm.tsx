import { Button, NumberInput, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { act } from '../../hooks';
import { toast } from '../../store';
import { carApi } from './client';
import { changed, optNum, type NumVal } from './shared';

export function ListingForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState<NumVal>('');
  const [year, setYear] = useState<NumVal>('');
  const [kmV, setKmV] = useState<NumVal>('');
  const [place, setPlace] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return void toast('Give it a title, e.g. Clio 2015 petrol');
    const u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) return void toast('The link must start with http:// or https://');
    setBusy(true);
    const r = await act(
      carApi.addListing({ title: title.trim(), price: optNum(price), year: optNum(year), km: optNum(kmV), place: place.trim() || undefined, url: u || undefined }),
    );
    setBusy(false);
    if (r === null) return;
    toast(r.existing ? 'Already saved' : 'Listing saved');
    setTitle('');
    setPrice('');
    setYear('');
    setKmV('');
    setPlace('');
    setUrl('');
    changed(false);
    onDone();
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm" pb="sm">
        <TextInput label="Title" placeholder="Renault Clio 2015 petrol" value={title} maxLength={120} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <NumberInput label="Price (USD)" value={price} onChange={setPrice} min={0} hideControls thousandSeparator=" " />
          <NumberInput label="Year" value={year} onChange={setYear} min={1950} max={2100} hideControls allowDecimal={false} />
          <NumberInput label="Km" value={kmV} onChange={setKmV} min={0} hideControls allowDecimal={false} thousandSeparator=" " />
          <TextInput label="Place" placeholder="Bab Ezzouar" value={place} maxLength={80} onChange={(e) => setPlace(e.currentTarget.value)} />
        </SimpleGrid>
        <TextInput label="Link" placeholder="https://…" value={url} maxLength={500} onChange={(e) => setUrl(e.currentTarget.value)} />
        <Button type="submit" loading={busy} style={{ alignSelf: 'flex-start' }}>
          Save listing
        </Button>
      </Stack>
    </form>
  );
}
