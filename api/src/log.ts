// Append-only action log: logs/actions.log, one tab-separated line per write. Never throws.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from './config.ts';

const clean = (s: string) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

export const logAction = (source: string, tool: string, summary: string): void => {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, 'actions.log'), `${new Date().toISOString()}\t${clean(source)}\t${clean(tool)}\t${clean(summary)}\n`);
  } catch (e) {
    console.error('logAction failed:', (e as Error).message);
  }
};
