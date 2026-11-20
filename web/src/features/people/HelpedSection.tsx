import { Badge, Group, Stack, TextInput } from '@mantine/core';
import { IconLifebuoy, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import * as f from '../../fmt';
import { act, useLoad, usePageActive } from '../../hooks';
import { IconBtn, Section } from '../../ui/Page';
import { deleteLater, Hint, LineForm, useHidden } from '../review/kit';
import { people } from './client';
import { Row } from './parts';

/** "stuck: walk 10 min" → situation "stuck", thing "walk 10 min". No colon → situation "stuck". */
export const parseHelped = (s: string): { situation: string; thing: string } => {
  const i = s.indexOf(':');
  if (i > 0) {
    const situation = s.slice(0, i).trim();
    const thing = s.slice(i + 1).trim();
    if (situation && thing) return { situation, thing };
  }
  return { situation: 'stuck', thing: s.trim() };
};

export function HelpedSection() {
  const active = usePageActive();
  const [search, setSearch] = useState('');
  const top = useLoad(() => people.helpedTop(), active, [], { key: 'people.helped.top' });
  const all = useLoad(() => people.helped(search.trim() || undefined), active, [search]);
  const hidden = useHidden();
  const reload = () => {
    void top.reload();
    void all.reload();
  };
  return (
    <Section title="What helped" icon={IconLifebuoy}>
      <Stack gap="sm">
        {top.data && top.data.length > 0 ? (
          <Group gap={6}>
            {top.data.map((h) => (
              <Badge key={h.thing} variant="light" tt="none" size="lg" fw={600}>
                {h.thing}{' '}
                <span className="num">×{h.times}</span>
              </Badge>
            ))}
          </Group>
        ) : top.data ? (
          <Hint>When something gets you unstuck, write it here.</Hint>
        ) : null}
        <LineForm
          label="What helped"
          placeholder="stuck: walk 10 min"
          button="Save"
          onSubmit={async (v) => {
            const b = parseHelped(v);
            if (!b.thing) return false;
            const r = await act(people.addHelped(b), 'Saved');
            if (r) reload();
            return !!r;
          }}
        />
        <TextInput aria-label="Search what helped" placeholder="Search" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        {all.data && (
          <Stack gap={0}>
            {all.data
              .filter((h) => !hidden.has(h.id))
              .map((h) => (
                <Row
                  key={h.id}
                  title={h.thing}
                  sub={`${h.situation} · ${f.ago(h.created_at)}${h.note ? ` · ${h.note}` : ''}`}
                  right={
                    <IconBtn
                      icon={IconTrash}
                      label={`Remove ${h.thing}`}
                      variant="subtle"
                      color="gray"
                      onClick={() =>
                        deleteLater({
                          text: 'Removed',
                          hide: () => hidden.hide(h.id),
                          restore: () => hidden.show(h.id),
                          run: () => people.removeHelped(h.id),
                          after: reload,
                        })
                      }
                    />
                  }
                />
              ))}
            {all.data.length === 0 && search.trim() && <Hint>No match.</Hint>}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}
