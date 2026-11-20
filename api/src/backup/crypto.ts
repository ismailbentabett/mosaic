// Backup encryption: gzip, then AES-256-GCM with a key derived from a passphrase (scrypt).
// File layout: MAGIC(8) | salt(16) | iv(12) | tag(16) | ciphertext. Any change to the bytes fails the tag check.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const MAGIC = Buffer.from('MOSAICB1', 'ascii');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV + TAG;

const deriveKey = (passphrase: string, salt: Buffer) => {
  if (!passphrase || passphrase.length < 12) throw new Error('Backup passphrase must be at least 12 characters');
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
};

export const encrypt = (plain: Buffer, passphrase: string): Buffer => {
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
};

export const decrypt = (blob: Buffer, passphrase: string): Buffer => {
  if (blob.length < HEADER || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Mosaic backup file');
  let o = MAGIC.length;
  const salt = blob.subarray(o, (o += SALT));
  const iv = blob.subarray(o, (o += IV));
  const tag = blob.subarray(o, (o += TAG));
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]));
  } catch {
    throw new Error('Wrong passphrase or corrupted backup');
  }
};
