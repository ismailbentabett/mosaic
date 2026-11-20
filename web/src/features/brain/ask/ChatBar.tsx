import { ActionIcon, Tooltip } from '@mantine/core';
import { IconHeadphones, IconHeadphonesOff, IconHistory, IconPencilPlus } from '@tabler/icons-react';
import { STROKE } from '../../../app/icons';
import { go } from '../../../router';
import { ASK } from './paths';

export function ChatBar({
  desktop,
  scrolled,
  title,
  voiceAvailable,
  voice,
  hasMessages,
  busy,
  onToggleVoice,
  onNew,
}: {
  desktop: boolean;
  scrolled: boolean;
  title: string;
  voiceAvailable: boolean;
  voice: boolean;
  hasMessages: boolean;
  busy: boolean;
  onToggleVoice: () => void;
  onNew: () => void;
}) {
  return (
    <header className="ck-bar" data-scrolled={scrolled || undefined}>
      {!desktop && (
        <Tooltip label="Chat history" openDelay={300}>
          <ActionIcon size="lg" variant="subtle" color="gray" onClick={() => go(`${ASK}/history`)} aria-label="Chat history">
            <IconHistory size={20} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
      )}
      <h1 className="ck-bar-title">{title}</h1>
      {voiceAvailable && (
        <Tooltip label={voice ? 'Voice on: replies are read aloud' : 'Voice off: tap to hear replies'} openDelay={300}>
          <ActionIcon
            size="lg"
            variant={voice ? 'light' : 'subtle'}
            color={voice ? undefined : 'gray'}
            onClick={onToggleVoice}
            aria-pressed={voice}
            aria-label="Voice mode"
          >
            {voice ? <IconHeadphones size={20} stroke={STROKE} /> : <IconHeadphonesOff size={20} stroke={STROKE} />}
          </ActionIcon>
        </Tooltip>
      )}
      {(!desktop || hasMessages) && (
        <Tooltip label="New chat" openDelay={300}>
          <ActionIcon size="lg" variant="subtle" color="gray" onClick={onNew} disabled={busy} aria-label="New chat">
            <IconPencilPlus size={20} stroke={STROKE} />
          </ActionIcon>
        </Tooltip>
      )}
    </header>
  );
}
