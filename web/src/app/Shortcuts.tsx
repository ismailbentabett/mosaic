import { useEffect } from 'react';
import { go, ASK_PATH } from '../router';
import { openKeys, openQuickCapture, openSettings, openVoice } from '../ui';
import { overlayOpen } from './back';
import { BRAND } from '../brand';
import { ALL, BOTTOM, type NavItem } from './navItems';

/** Every place with a number key, in key order (1 Chat, 2 Today, 3 Life, 4 Brain, 5 Tasks). */
const NUMBERED: NavItem[] = [...BOTTOM, ...ALL]
  .filter((n, i, a) => n.key && a.findIndex((m) => m.key === n.key) === i)
  .sort((a, b) => a.key!.localeCompare(b.key!));
/** Every place with a `g` chord letter; the first owner of a letter wins. */
const LETTERED: NavItem[] = [...BOTTOM, ...ALL].filter((n, i, a) => n.letter && a.findIndex((m) => m.letter === n.letter) === i);

/** Second key of a `g` chord must come within this window. */
const CHORD_MS = 1500;

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isTyping(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest(TYPING);
}

/** Focuses an element once it exists (screens are lazy). */
export async function focusWhenReady(selector: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function toPlace(path: string) {
  go(path);
}

/**
 * Global keys (never while typing or with a sheet open):
 * 1–5 places · g chords (letters from navItems) · j chat with the assistant · v talk to the assistant · c quick add · ? keys · , settings · / search.
 * Ctrl/⌘K (Spotlight) is bound by Mantine Spotlight itself.
 */
export function Shortcuts() {
  useEffect(() => {
    let chordUntil = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return;
      if (overlayOpen() || isTyping(e.target)) {
        chordUntil = 0;
        return;
      }
      if (chordUntil) {
        const live = Date.now() < chordUntil;
        chordUntil = 0;
        if (live) {
          const item = LETTERED.find((n) => n.letter === e.key);
          if (item) {
            e.preventDefault();
            toPlace(item.path);
            return;
          }
        }
      }
      const tab = NUMBERED.find((t) => t.key === e.key);
      if (tab) {
        e.preventDefault();
        toPlace(tab.path);
        return;
      }
      switch (e.key) {
        case 'g':
          e.preventDefault();
          chordUntil = Date.now() + CHORD_MS;
          break;
        case 'j':
          e.preventDefault();
          toPlace(ASK_PATH);
          break;
        case 'v':
          e.preventDefault();
          openVoice();
          break;
        case '?':
          e.preventDefault();
          openKeys();
          break;
        case ',':
          e.preventDefault();
          openSettings();
          break;
        case 'c':
          e.preventDefault();
          openQuickCapture();
          break;
        case '/':
          e.preventDefault();
          if (!location.hash.startsWith('#/brain/search')) toPlace('/brain/search');
          void focusWhenReady('#brain-search');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

/** The list the Keys sheet shows. Places come from navItems, so the sheet cannot drift from the keys. */
export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Search everything (Spotlight)' },
  { keys: ['c'], label: 'Quick add' },
  { keys: ['v'], label: `Talk to ${BRAND.assistant}` },
  ...NUMBERED.map((n) => ({ keys: [n.key!], label: n.label })),
  ...LETTERED.map((n) => ({ keys: ['g', n.letter!], label: `Go to ${n.label}` })),
  { keys: ['j'], label: `Chat with ${BRAND.assistant}` },
  { keys: ['/'], label: 'Search the brain' },
  { keys: [','], label: 'Settings' },
  { keys: ['?'], label: 'This list' },
  { keys: ['Esc'], label: 'Close a sheet' },
];
