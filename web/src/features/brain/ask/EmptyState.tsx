import { UnstyledButton } from '@mantine/core';
import { IconBolt, IconCalendarEvent, IconCamera, IconGasStation, IconToolsKitchen2, IconWallet, type Icon } from '@tabler/icons-react';
import { type RefObject } from 'react';
import { STROKE } from '../../../app/icons';
import { BRAND } from '../../../brand';
import { hm } from '../../../time';
import { SUGGESTIONS } from '../chat';

// ---------- empty state ----------

const CARD: Record<string, { icon: Icon; hint: string }> = {
  'What now?': { icon: IconBolt, hint: 'Your next step, right now' },
  'Plan tomorrow': { icon: IconCalendarEvent, hint: "Fill tomorrow's blocks" },
  'Snap a receipt': { icon: IconCamera, hint: 'Photo in, expense logged' },
  'Log a meal': { icon: IconToolsKitchen2, hint: 'Food and calories' },
  'Log fuel': { icon: IconGasStation, hint: 'Litres, price, km' },
  'How much did I spend this week?': { icon: IconWallet, hint: "This week's money" },
};

function greeting() {
  const h = Number(hm(Date.now()).slice(0, 2));
  if (h >= 4 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function EmptyState({
  busy,
  sendNow,
  setInput,
  camRef,
  focusEnd,
}: {
  busy: boolean;
  sendNow: (text: string) => Promise<unknown>;
  setInput: (v: string) => void;
  camRef: RefObject<HTMLInputElement | null>;
  focusEnd: () => void;
}) {
  return (
    <section className="ck-empty" aria-labelledby="ck-hello">
      <h2 className="ck-hello" id="ck-hello">
        {greeting()}.
      </h2>
      <p className="ck-hello-sub">Type, talk or send a photo. {BRAND.assistant} reads and fills your tasks, calendar, money, food, gym, body and car.</p>
      <ul className="ck-cards" aria-label="Suggestions">
        {SUGGESTIONS.map((s) => {
          const c = CARD[s.label];
          const Ico = c?.icon ?? IconBolt;
          return (
            <li key={s.label}>
              <UnstyledButton
                className="ck-card"
                disabled={busy}
                onClick={() => {
                  if (s.mode === 'send') void sendNow(s.prompt);
                  else {
                    setInput(s.prompt);
                    if (s.mode === 'camera') camRef.current?.click();
                    else focusEnd();
                  }
                }}
              >
                <span className="ck-card-icon" aria-hidden="true">
                  <Ico size={18} stroke={STROKE} />
                </span>
                <span className="ck-card-label">{s.label}</span>
                {c && <span className="ck-card-hint">{c.hint}</span>}
              </UnstyledButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
