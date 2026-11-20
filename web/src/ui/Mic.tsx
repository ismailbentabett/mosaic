import { ActionIcon, Alert, Button, Group, Text, Tooltip, type ActionIconProps } from '@mantine/core';
import { IconMicrophone, IconPlayerStopFilled, IconVolume } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { STROKE } from '../app/icons';
import { clock } from '../fmt';
import { useNow } from '../hooks';
import { feel } from '../sound';
import { toast } from '../store';
import { canListen, canMeter, canSpeak, isSpeaking, listen, meter, openMicSettings, speak, stopSpeaking, VOICE_ERRORS, type Listener, type VoiceError } from '../voice';

export type DictationError = { code: VoiceError; message: string };

/**
 * Hook around SpeechRecognition: start/stop, live transcript, one sound on each edge.
 * onText gets the running transcript of this take; onEnd the final one.
 * `quiet` keeps errors inline (`error`, `clearError`) instead of a toast, and treats an empty take
 * as "Did not catch that." so the UI can offer a retry.
 * `levelRef` goes on the element whose `--cap-level` (0..1) follows the input: the mic meter on
 * desktop, speech start/stop where no meter runs (phones).
 */
export function useDictation(o: { onText?: (t: string) => void; onEnd?: (t: string) => void; continuous?: boolean; quiet?: boolean }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const rec = useRef<Listener | null>(null);
  const stopMeter = useRef<(() => void) | null>(null);
  const levelEl = useRef<HTMLElement | null>(null);
  const cb = useRef(o);
  cb.current = o;

  const setLevel = (l: number) => levelEl.current?.style.setProperty('--cap-level', l.toFixed(3));
  const endMeter = () => {
    stopMeter.current?.();
    stopMeter.current = null;
  };

  useEffect(
    () => () => {
      rec.current?.abort();
      endMeter();
    },
    [],
  );

  const fail = (code: VoiceError, message = VOICE_ERRORS[code]) => {
    feel('error');
    if (cb.current.quiet) setError({ code, message });
    else if (code === 'denied' && openMicSettings) toast(message, { timeout: 8000, action: { label: 'Settings', run: openMicSettings } });
    else toast(message);
  };

  const start = () => {
    if (rec.current) return;
    stopSpeaking();
    setError(null);
    let failed = false; // an error already explains this take; do not add "Did not catch that."
    const r = listen({
      continuous: cb.current.continuous,
      onText: (t) => cb.current.onText?.(t),
      onSpeech: (s) => {
        setSpeaking(s);
        if (!canMeter) setLevel(s ? 0.6 : 0);
      },
      onEnd: (t) => {
        rec.current = null;
        endMeter();
        setOn(false);
        setStartedAt(null);
        setSpeaking(false);
        feel('micOff');
        if (!t && !failed && cb.current.quiet) setError({ code: 'no-speech', message: VOICE_ERRORS['no-speech'] });
        cb.current.onEnd?.(t);
      },
      onError: (m, code) => {
        failed = true;
        fail(code, m);
      },
    });
    if (!r) {
      fail('failed', 'Voice did not start. Check the mic permission.');
      return;
    }
    rec.current = r;
    setOn(true);
    setStartedAt(Date.now());
    feel('micOn');
    if (canMeter) stopMeter.current = meter(setLevel);
  };
  const stop = () => rec.current?.stop();
  /** Drops the take without an end event (e.g. the text was just saved). */
  const abort = () => {
    if (!rec.current) return;
    rec.current.abort();
    rec.current = null;
    endMeter();
    setOn(false);
    setStartedAt(null);
    setSpeaking(false);
  };
  const toggle = () => (rec.current ? stop() : start());
  const clearError = () => setError(null);
  const levelRef = useCallback((el: HTMLElement | null) => {
    levelEl.current = el;
  }, []);
  return { on, start, stop, abort, toggle, supported: canListen, error, clearError, startedAt, speaking, levelRef };
}

export type Dictation = ReturnType<typeof useDictation>;

/** Elapsed recording time, ticking while on. */
export function MicElapsed({ startedAt }: { startedAt: number | null }) {
  const now = useNow(startedAt !== null, 250);
  if (startedAt === null) return null;
  return (
    <Text component="span" size="xs" c="red" fw={600} className="num" aria-hidden="true">
      {clock(now - startedAt)}
    </Text>
  );
}

/** The record toggle for a dictation hook. A soft red halo follows the input level while on. */
export function MicToggle({
  d,
  label = 'Dictate',
  showLabel = false,
  elapsed = false,
  onPress,
  size = 'lg',
  variant = 'subtle',
}: {
  d: Dictation;
  label?: string;
  showLabel?: boolean;
  elapsed?: boolean;
  /** Runs before the toggle (e.g. remember the text dictation appends to). */
  onPress?: () => void;
  size?: ActionIconProps['size'];
  variant?: ActionIconProps['variant'];
}) {
  if (!d.supported) return null;
  const press = () => {
    onPress?.();
    d.toggle();
  };
  const halo = d.on
    ? { boxShadow: '0 0 0 calc(2px + var(--cap-level, 0) * 10px) color-mix(in srgb, var(--mantine-color-red-filled) 28%, transparent)', transition: 'box-shadow 80ms linear' }
    : undefined;
  if (showLabel) {
    return (
      <Group gap={6} wrap="nowrap">
        <Button
          ref={d.levelRef as (el: HTMLButtonElement | null) => void}
          variant={d.on ? 'filled' : 'light'}
          color={d.on ? 'signal' : undefined}
          leftSection={d.on ? <IconPlayerStopFilled size={16} /> : <IconMicrophone size={18} stroke={STROKE} />}
          onClick={press}
          aria-label={d.on ? 'Stop recording' : label}
          style={halo}
        >
          {d.on ? 'Stop' : label}
        </Button>
        {elapsed && <MicElapsed startedAt={d.startedAt} />}
      </Group>
    );
  }
  return (
    <Group gap={6} wrap="nowrap">
      <Tooltip label={d.on ? 'Stop recording' : label} openDelay={400}>
        <ActionIcon
          ref={d.levelRef as (el: HTMLButtonElement | null) => void}
          size={size}
          radius="xl"
          variant={d.on ? 'filled' : variant}
          color={d.on ? 'signal' : 'gray'}
          onClick={press}
          aria-label={d.on ? 'Stop recording' : label}
          aria-pressed={d.on}
          style={halo}
        >
          {d.on ? <IconPlayerStopFilled size={16} /> : <IconMicrophone size={20} stroke={STROKE} />}
        </ActionIcon>
      </Tooltip>
      {elapsed && <MicElapsed startedAt={d.startedAt} />}
    </Group>
  );
}

/** Calm inline voice error with a retry. role="alert" so screen readers read it once. */
export function MicError({ error, onRetry, onDismiss }: { error: DictationError | null; onRetry: () => void; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <Alert role="alert" color="gray" variant="light" py="xs">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm">{error.message}</Text>
        <Group gap={4} wrap="nowrap">
          {error.code === 'denied' && openMicSettings && (
            <Button size="compact-sm" variant="subtle" onClick={openMicSettings}>
              Settings
            </Button>
          )}
          <Button size="compact-sm" variant="subtle" onClick={onRetry}>
            Try again
          </Button>
          {onDismiss && (
            <Button size="compact-sm" variant="subtle" color="gray" onClick={onDismiss}>
              Type instead
            </Button>
          )}
        </Group>
      </Group>
    </Alert>
  );
}

/** Mic button that writes into a text field. Dictation appends to the text that was there before. */
export function MicButton({
  value,
  onChange,
  label = 'Dictate',
  showLabel = false,
  onDone,
  size,
  variant,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  showLabel?: boolean;
  onDone?: (v: string) => void;
  size?: ActionIconProps['size'];
  variant?: ActionIconProps['variant'];
}) {
  const base = useRef('');
  const join = (t: string) => (base.current && t ? base.current.replace(/\s*$/, ' ') : base.current) + t;
  const d = useDictation({
    onText: (t) => onChange(join(t)),
    onEnd: (t) => onDone?.(join(t)),
  });
  return (
    <MicToggle
      d={d}
      label={label}
      showLabel={showLabel}
      size={size}
      variant={variant}
      onPress={() => {
        if (!d.on) base.current = value;
      }}
    />
  );
}

/** Reads a piece of text aloud; tap again to stop. */
export function SpeakButton({ text, label = 'Read aloud' }: { text: string; label?: string }) {
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  useEffect(() => () => void (onRef.current && stopSpeaking()), []);
  if (!canSpeak || !text) return null;
  return (
    <Button
      size="compact-sm"
      variant="subtle"
      color="gray"
      leftSection={on ? <IconPlayerStopFilled size={14} /> : <IconVolume size={16} stroke={STROKE} />}
      aria-label={on ? 'Stop reading' : label}
      onClick={() => {
        if (on || isSpeaking()) {
          stopSpeaking();
          setOn(false);
          return;
        }
        setOn(true);
        speak(text, { onEnd: () => setOn(false) });
      }}
    >
      {on ? 'Stop' : label}
    </Button>
  );
}
