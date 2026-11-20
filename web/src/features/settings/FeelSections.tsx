import { Box, Button, Group, Kbd, Radio, Slider, Stack, Switch, Text } from '@mantine/core';
import { IconMicrophone, IconPalette, IconPlayerPlay, IconVolume } from '@tabler/icons-react';
import { useRef, type ReactNode } from 'react';
import { STROKE } from '../../app/icons';
import { fixed, pct } from '../../fmt';
import { prefs, setTheme, THEMES, type ThemeId, type VoiceLang } from '../../prefs';
import { feel } from '../../sound';
import { useStore } from '../../store';
import { Notice, Section } from '../../ui/Page';
import { canListen, canSpeak, speak } from '../../voice';
import { clampScale, display, SCALE } from './display';
import { LANGS } from './langs';

const speed = (n: number) => `${fixed(n, 2)}×`;

/** A labelled switch with optional help under the label. */
function Toggle({ label, help, on, onChange, disabled }: { label: string; help?: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      checked={on}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.checked)}
      label={label}
      description={help}
      labelPosition="left"
      styles={{ body: { justifyContent: 'space-between' }, labelWrapper: { flex: 1 } }}
    />
  );
}

/** Radio cards: name plus one line of help. */
function Choice<T extends string>({ value, onChange, label, options }: { value: T; onChange: (v: T) => void; label: string; options: { id: T; name: string; help?: string; lang?: string }[] }) {
  return (
    <Radio.Group value={value} onChange={(v) => onChange(v as T)} aria-label={label}>
      <Stack gap={6}>
        {options.map((o) => (
          <Radio.Card key={o.id} value={o.id} radius="md" p="sm">
            <Group wrap="nowrap" gap="sm" align="flex-start">
              <Radio.Indicator mt={2} />
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} lang={o.lang}>
                  {o.name}
                </Text>
                {o.help && (
                  <Text size="xs" c="dimmed" lang={o.lang}>
                    {o.help}
                  </Text>
                )}
              </Box>
            </Group>
          </Radio.Card>
        ))}
      </Stack>
    </Radio.Group>
  );
}

function SliderRow({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm">{label}</Text>
        <Text size="sm" c="dimmed" className="num">
          {value}
        </Text>
      </Group>
      {children}
    </Stack>
  );
}

// ---- Appearance ----

export function AppearanceSection() {
  const { theme, fullHome } = useStore(prefs);
  const { scale, reduceMotion } = useStore(display);
  const point = useRef<{ x: number; y: number } | undefined>(undefined);

  const pickTheme = (id: ThemeId) => {
    if (id === theme) return;
    setTheme(id, point.current);
    feel('theme');
  };

  return (
    <Section title="Appearance" icon={IconPalette}>
      <Stack gap="md">
        <Box
          onPointerDown={(e) => {
            point.current = { x: e.clientX, y: e.clientY };
          }}
        >
          <Choice value={theme} onChange={pickTheme} label="Theme" options={THEMES.map((t) => ({ id: t.id, name: t.name, help: t.help }))} />
        </Box>
        <SliderRow label="Text size" value={pct(scale / 100)}>
          <Slider
            min={SCALE.min}
            max={SCALE.max}
            step={SCALE.step}
            value={scale}
            onChange={(v) => display.set({ scale: clampScale(v) })}
            label={(v) => pct(v / 100)}
            marks={[{ value: 100 }]}
            aria-label="Text size"
            thumbLabel="Text size"
          />
        </SliderRow>
        <Toggle label="Reduce motion" help="No sliding, fading or bouncing. The OS setting also counts." on={reduceMotion} onChange={(v) => display.set({ reduceMotion: v })} />
        <Toggle
          label="Always the full Today"
          help="Off: after 23:00 and on Saturday, Today shows only the few things that fit the hour."
          on={fullHome}
          onChange={(v) => prefs.set({ fullHome: v })}
        />
      </Stack>
    </Section>
  );
}

// ---- Feel ----

export function FeelSection() {
  const { sound, haptics } = useStore(prefs);
  const on = sound !== 'off';

  const setSounds = (v: boolean) => {
    if (v === on) return;
    prefs.set({ sound: v ? 'soft' : 'off' });
    if (v) feel('done', 'soft');
  };

  return (
    <Section title="Feel" icon={IconVolume}>
      <Stack gap="md">
        <Toggle
          label="Sounds"
          help={on ? 'One soft chime on done, capture and timers. Follows the phone volume.' : 'Silent. Vibration still works.'}
          on={on}
          onChange={setSounds}
        />
        <Toggle
          label="Haptics"
          help="Short buzz on taps and done items, where the phone supports it."
          on={haptics}
          onChange={(v) => {
            prefs.set({ haptics: v });
            if (v) feel('tap');
          }}
        />
      </Stack>
    </Section>
  );
}

// ---- Voice ----

export function VoiceSection() {
  const { voiceLang, rate, speakTimer } = useStore(prefs);
  const lang = LANGS.find((l) => l.id === voiceLang) ?? LANGS[0];

  if (!canListen && !canSpeak) {
    return (
      <Section title="Voice" icon={IconMicrophone}>
        <Text size="sm" c="dimmed">
          This browser has no speech support. Chrome, Edge or Safari have it.
        </Text>
      </Section>
    );
  }

  return (
    <Section title="Voice" icon={IconMicrophone}>
      <Stack gap="md">
        <Choice
          value={voiceLang}
          onChange={(v: VoiceLang) => prefs.set({ voiceLang: v })}
          label="Voice language"
          options={LANGS.map((l) => ({ id: l.id, name: l.name, lang: l.id }))}
        />
        {canSpeak && (
          <SliderRow label="Speaking speed" value={speed(rate)}>
            <Group wrap="nowrap" gap="sm">
              <Slider
                style={{ flex: 1 }}
                min={0.7}
                max={1.4}
                step={0.05}
                value={rate}
                label={speed}
                onChange={(v) => prefs.set({ rate: v })}
                aria-label="Speaking speed"
                thumbLabel="Speaking speed"
              />
              <Button size="compact-sm" variant="default" leftSection={<IconPlayerPlay size={14} stroke={STROKE} />} onClick={() => speak(lang.sample)}>
                Test
              </Button>
            </Group>
          </SliderRow>
        )}
        {canSpeak && <Toggle label="Say when a timer ends" on={speakTimer} onChange={(v) => prefs.set({ speakTimer: v })} />}
        <Notice>
          Press <Kbd size="xs">v</Kbd> for voice commands, <Kbd size="xs">j</Kbd> to chat with the assistant. Chrome sends dictated audio to Google to turn it into text.
        </Notice>
      </Stack>
    </Section>
  );
}
