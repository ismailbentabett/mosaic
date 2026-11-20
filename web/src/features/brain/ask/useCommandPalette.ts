import { useEffect, useState, type KeyboardEvent } from 'react';
import { COMMANDS } from '../chat';

/** The / command palette: matches for the typed command, the selected row, and its keys in the field. */
export function useCommandPalette(input: string, busy: boolean, setInput: (v: string) => void) {
  const slash = input.startsWith('/') && !/\s/.test(input);
  const matches = slash ? COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase())) : [];
  const paletteOpen = matches.length > 0 && !busy;
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [input]);
  const selIdx = Math.min(sel, Math.max(0, matches.length - 1));
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!paletteOpen) return false;
    if (e.key === 'Escape') {
      setInput('');
      return true;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = matches.length;
      setSel((selIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      return true;
    }
    if (e.key === 'Tab' && !e.shiftKey && input !== matches[selIdx]!.cmd) {
      e.preventDefault();
      setInput(matches[selIdx]!.cmd);
      return true;
    }
    return false;
  };
  return { matches, paletteOpen, setSel, selIdx, onKeyDown };
}
