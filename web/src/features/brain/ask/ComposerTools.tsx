import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconCamera, IconPaperclip, IconSlash } from '@tabler/icons-react';
import { type RefObject } from 'react';
import { STROKE } from '../../../app/icons';

/** Left of the field: attach (camera or file) and the commands button. */
export function ComposerTools({
  camRef,
  fileRef,
  busy,
  openCommands,
}: {
  camRef: RefObject<HTMLInputElement | null>;
  fileRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  openCommands: () => void;
}) {
  return (
    <>
      <Menu position="top-start" withinPortal shadow="md">
        <Menu.Target>
          <Tooltip label="Attach" openDelay={300}>
            <ActionIcon size={34} radius="xl" variant="subtle" color="gray" aria-label="Attach a photo or file">
              <IconPaperclip size={19} stroke={STROKE} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconCamera size={16} stroke={STROKE} />} onClick={() => camRef.current?.click()}>
            Take a photo
          </Menu.Item>
          <Menu.Item leftSection={<IconPaperclip size={16} stroke={STROKE} />} onClick={() => fileRef.current?.click()}>
            Photo or file
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Tooltip label="Commands ( / )" openDelay={300}>
        <ActionIcon size={34} radius="xl" variant="subtle" color="gray" aria-label="Commands" disabled={busy} onClick={openCommands}>
          <IconSlash size={19} stroke={STROKE} />
        </ActionIcon>
      </Tooltip>
    </>
  );
}
