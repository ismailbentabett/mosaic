import { UnstyledButton } from '@mantine/core';
import { type COMMANDS } from '../chat';

export function CommandPalette({
  matches,
  selIdx,
  setSel,
  runCommand,
}: {
  matches: typeof COMMANDS;
  selIdx: number;
  setSel: (i: number) => void;
  runCommand: (cmd: string) => void;
}) {
  return (
    <div className="ck-palette" id="chat-palette" role="listbox" aria-label="Commands">
      {matches.map((c, i) => (
        <UnstyledButton
          key={c.cmd}
          id={`chat-cmd-${i}`}
          className="ck-cmd"
          role="option"
          aria-selected={i === selIdx}
          tabIndex={-1}
          onMouseEnter={() => setSel(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand(c.cmd)}
        >
          <span className="ck-cmd-name">{c.cmd}</span>
          <span className="ck-cmd-help">{c.help}</span>
        </UnstyledButton>
      ))}
    </div>
  );
}
