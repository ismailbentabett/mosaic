import { BRAND } from './brand';

export { BRAND };

/**
 * Shared strings. Sentence case, no exclamation marks, no praise, no guilt.
 * Screens use these so empty, error and toast lines read the same everywhere.
 */
export const copy = {
  brand: BRAND.name,
  tagline: BRAND.tagline,
  assistant: BRAND.assistant,
  askPlaceholder: 'Ask anything about today',

  empty: {
    generic: 'Nothing here yet.',
    tasks: 'No tasks here.',
    inbox: 'Inbox is clear.',
    notes: 'No notes yet.',
    search: 'No matches.',
    money: 'No expenses logged.',
    food: 'Nothing logged today.',
    gym: 'No sets logged.',
    body: 'No entries yet.',
    blocks: 'No blocks today.',
  },

  error: {
    title: 'Something failed',
    unreachable: `Could not reach ${BRAND.name}`,
    unreachableText: `Could not reach ${BRAND.name}. Your change is saved and will sync.`,
    retry: 'Try again',
    details: 'Details',
  },

  offline: 'Offline. Changes will sync.',
  synced: (n: number) => (n === 1 ? 'Synced 1 change' : `Synced ${n} changes`),

  toast: {
    saved: 'Saved',
    deleted: 'Deleted',
    done: 'Done',
    undone: 'Undone',
    undo: 'Undo',
    captured: 'Captured',
    copied: 'Copied',
  },
} as const;
