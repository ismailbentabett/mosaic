import { Badge, Button, Group, Menu, NumberInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconDots, IconFileCertificate, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { STROKE } from '../../app/icons';
import * as f from '../../fmt';
import { act, usePageActive } from '../../hooks';
import { toast } from '../../store';
import { lifeYmd } from '../../time';
import { Async, IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, useAsk, useHidden } from '../review/kit';
import { carApi, PAPER_KINDS, PAPER_LABEL } from './client';
import { NoCar } from './NoCar';
import { changed, optNum, STATE_BADGE, useOverview, type NumVal } from './shared';

/* ---------- Papers ---------- */

export function PapersPane() {
  const active = usePageActive();
  const o = useOverview(active);
  const hidden = useHidden();
  const [askNode, ask] = useAsk();
  return (
    <Async state={o} lines={3}>
      {(d) => {
        if (!d.car) return <NoCar />;
        const papers = (d.papers ?? []).filter((p) => !hidden.has(p.id));
        const dueOf = (id: string) => d.due.find((x) => x.source === 'paper' && x.id === id);
        const renew = (id: string, name: string) =>
          ask({
            title: `Renew: ${name}`,
            label: 'New end date',
            type: 'date',
            hint: 'The old one stays in history. Add the amount from the Money tab if you paid.',
            save: 'Renew',
            onSave: async (v) => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                toast('Pick a date');
                return false;
              }
              const r = await act(carApi.renewPaper(id, { expires_on: v }), 'Renewed');
              if (r !== null) changed(false);
              return r !== null;
            },
          });
        return (
          <Stack gap="md">
            <Section title="Papers" icon={IconFileCertificate} hint="End dates only. Document numbers stay in the password manager.">
              {papers.length === 0 ? (
                <Hint>Add insurance, the technical check and the vignette with their end dates. They show up in Coming up 30 days ahead.</Hint>
              ) : (
                <Stack gap="sm">
                  {papers.map((p) => {
                    const due = dueOf(p.id);
                    return (
                      <Group key={p.id} justify="space-between" wrap="nowrap" gap="xs">
                        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                          <Text size="sm" fw={600} truncate>
                            {p.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {[p.expires_on ? `ends ${f.day(p.expires_on)}` : 'no end date', p.amount != null ? f.money(p.amount, p.currency) : null, p.where_kept]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </Stack>
                        {due && due.state !== 'later' && (
                          <Badge variant="light" color="yellow" size="sm">
                            {STATE_BADGE[due.state].label}
                          </Badge>
                        )}
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <IconBtn icon={IconDots} label={`${p.name} options`} variant="subtle" color="gray" size="md" />
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconRefresh size={16} stroke={STROKE} />} onClick={() => renew(p.id, p.name)}>
                              Renew
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconTrash size={16} stroke={STROKE} />}
                              onClick={() =>
                                deleteLater({
                                  text: `${p.name} removed`,
                                  hide: () => hidden.hide(p.id),
                                  restore: () => hidden.show(p.id),
                                  run: () => carApi.removePaper(p.id),
                                  after: () => changed(true),
                                })
                              }
                            >
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    );
                  })}
                </Stack>
              )}
            </Section>
            <Section title="Add a paper" icon={IconFileCertificate}>
              <PaperForm currency={d.car.currency} />
            </Section>
            {askNode}
          </Stack>
        );
      }}
    </Async>
  );
}

function PaperForm({ currency }: { currency: string }) {
  const [kind, setKind] = useState<string>('insurance');
  const [expires, setExpires] = useState('');
  const [amount, setAmount] = useState<NumVal>('');
  const [where, setWhere] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act(
      carApi.addPaper({ kind, expires_on: expires || undefined, amount: optNum(amount), where_kept: where.trim() || undefined, paid_on: optNum(amount) ? lifeYmd() : undefined }),
      'Paper saved',
    );
    setBusy(false);
    if (r === null) return;
    if (r.money_note) toast(r.money_note);
    setExpires('');
    setAmount('');
    setWhere('');
    changed(r.record_id != null);
  };
  return (
    <form onSubmit={(e) => void submit(e)}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select label="Paper" data={PAPER_KINDS.map((k) => ({ value: k, label: PAPER_LABEL[k] }))} value={kind} onChange={(v) => setKind(v ?? 'insurance')} allowDeselect={false} />
          <TextInput label="Ends on" type="date" value={expires} onChange={(e) => setExpires(e.currentTarget.value)} />
          <NumberInput label={`Paid (${currency})`} value={amount} onChange={setAmount} min={0} hideControls thousandSeparator=" " description="Optional, goes to Money" />
          <TextInput label="Kept where" placeholder="Glovebox, home folder…" value={where} maxLength={120} onChange={(e) => setWhere(e.currentTarget.value)} />
        </SimpleGrid>
        <Button type="submit" loading={busy} style={{ alignSelf: 'flex-start' }}>
          Save paper
        </Button>
      </Stack>
    </form>
  );
}
