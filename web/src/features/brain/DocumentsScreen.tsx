// Documents: papers that expire. Name, expiry date, where it is kept. Never the number itself.
import { Box, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { PLACE_ICON, STROKE } from '../../app/icons';
import { day, num, plural } from '../../fmt';
import { usePageActive } from '../../hooks';
import { toast, toastUndo } from '../../store';
import { act, useLoad } from '../../ui/data';
import { Empty, ErrorState, Loading, Page, Section } from '../../ui/Page';
import { v2, type Doc } from '../../v2';
import { Row, Rows } from './parts';

function docWhen(d: Doc): string {
  if (!d.expires_on || d.days_left === null) return 'No expiry date';
  if (d.days_left < 0) return `Expired ${day(d.expires_on).toLowerCase()}`;
  if (d.days_left === 0) return 'Expires today';
  return `Expires ${day(d.expires_on).toLowerCase()} · ${plural(d.days_left, 'day')}`;
}

export function DocumentsScreen() {
  const active = usePageActive();
  const list = useLoad(() => v2.documents(), active, [], { key: 'documents' });
  const [editing, setEditing] = useState<Doc | 'new' | null>(null);
  const done = () => {
    setEditing(null);
    void list.reload();
  };
  const remove = async (d: Doc) => {
    const r = await act(v2.deleteDocument(d.id));
    if (r === null) return;
    list.setData((p) => (p ? p.filter((x) => x.id !== d.id) : p));
    toastUndo('Removed', () => {
      void act(v2.addDocument({ name: d.name, expires_on: d.expires_on, where_kept: d.where_kept, note: d.note })).then(() => void list.reload());
    });
  };
  const docs = list.data;
  return (
    <Page
      title="Documents"
      icon={PLACE_ICON.documents}
      back="/brain"
      actions={
        editing !== 'new' ? (
          <Button size="sm" variant="light" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => setEditing('new')}>
            Add
          </Button>
        ) : undefined
      }
    >
      <Text size="sm" c="dimmed">
        Papers that expire: passport, ID card, licence, insurance. Name, date and where it is kept. Never the number itself.
      </Text>
      {editing === 'new' && (
        <Section title="Add a document">
          <DocForm onDone={done} />
        </Section>
      )}
      {list.error && !docs && <ErrorState error={list.error} onRetry={() => void list.reload()} />}
      {!docs && !list.error && <Loading label="Loading documents" lines={3} />}
      {docs && docs.length === 0 && editing !== 'new' && (
        <Empty
          title="No documents yet."
          icon={PLACE_ICON.documents}
          action={
            <Button variant="light" leftSection={<IconPlus size={16} stroke={STROKE} />} onClick={() => setEditing('new')}>
              Add document
            </Button>
          }
        >
          Add the one that expires first.
        </Empty>
      )}
      {docs && docs.length > 0 && (
        <Section title="Papers" hint={num(docs.length)} flush>
          <Rows label="Documents">
            {docs.map((d) =>
              editing !== 'new' && editing?.id === d.id ? (
                <Row key={d.id} py="md">
                  <DocForm doc={d} onDone={done} />
                </Row>
              ) : (
                <Row key={d.id}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600}>
                        {d.name}
                      </Text>
                      <Text size="xs" c={d.days_left !== null && d.days_left <= 30 ? undefined : 'dimmed'} className="num">
                        {[docWhen(d), d.where_kept].filter(Boolean).join(' · ')}
                      </Text>
                      {d.note && (
                        <Text size="xs" c="dimmed">
                          {d.note}
                        </Text>
                      )}
                    </Box>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        leftSection={<IconPencil size={14} stroke={STROKE} />}
                        aria-label={`Edit ${d.name}`}
                        onClick={() => setEditing(d)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="gray"
                        leftSection={<IconTrash size={14} stroke={STROKE} />}
                        aria-label={`Remove ${d.name}`}
                        onClick={() => void remove(d)}
                      >
                        Remove
                      </Button>
                    </Group>
                  </Group>
                </Row>
              ),
            )}
          </Rows>
        </Section>
      )}
    </Page>
  );
}

function DocForm({ doc, onDone }: { doc?: Doc; onDone: () => void }) {
  const [name, setName] = useState(doc?.name ?? '');
  const [exp, setExp] = useState(doc?.expires_on ?? '');
  const [where, setWhere] = useState(doc?.where_kept ?? '');
  const [note, setNote] = useState(doc?.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      toast('A document needs a name');
      return;
    }
    setBusy(true);
    const body = { name: name.trim(), expires_on: exp || null, where_kept: where.trim() || null, note: note.trim() || null };
    const r = await act(doc ? v2.patchDocument(doc.id, body) : v2.addDocument(body));
    setBusy(false);
    if (r) {
      toast(doc ? 'Saved' : 'Added');
      onDone();
    }
  };
  return (
    <form onSubmit={save}>
      <Stack gap="sm">
        <TextInput
          label="Name"
          data-draft
          maxLength={80}
          placeholder="Passport"
          autoComplete="off"
          autoFocus={!doc}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput label="Expires on (optional)" type="date" value={exp} onChange={(e) => setExp(e.currentTarget.value)} />
        <TextInput
          label="Where it is kept (optional)"
          maxLength={120}
          placeholder="Blue folder, top drawer"
          autoComplete="off"
          value={where}
          onChange={(e) => setWhere(e.currentTarget.value)}
        />
        <TextInput label="Note (optional, never an ID number)" maxLength={300} autoComplete="off" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group gap="xs">
          <Button type="submit" loading={busy}>
            {doc ? 'Save' : 'Add document'}
          </Button>
          <Button variant="default" onClick={onDone}>
            Cancel
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
