/**
 * Old import path. Captures now live in the one offline queue (outbox.ts): same IndexedDB,
 * same order, same Unsent list. Import from './outbox' in new code.
 */
export { cancel, capture, captureItem, flush, startQueue, type CaptureOut } from './outbox';
