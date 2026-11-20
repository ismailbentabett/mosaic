# Encrypted backups

Mosaic keeps everything in one SQLite file. `cli backup` turns it into a single encrypted file. That file can stay on local disk, go to any S3-compatible bucket, or both.

## What a backup is

1. **Snapshot.** The live database is copied with `VACUUM INTO`. The copy is consistent even while the API is serving requests.
2. **Compress.** The snapshot is gzipped.
3. **Encrypt.** The compressed snapshot is encrypted with AES-256-GCM. The key comes from your passphrase through scrypt (N = 2^15, r = 8, p = 1), with a fresh random salt for every backup.

File layout:

```
MOSAICB1 | salt (16 B) | iv (12 B) | GCM tag (16 B) | ciphertext
```

Files are named `mosaic-YYYYMMDDTHHMMSSZ.db.gz.enc`. Each local copy gets a `.sha256` sidecar, so you can check it without decrypting.

The GCM tag authenticates the whole file. A wrong passphrase or a corrupted byte fails loudly, and nothing is written.

## Configure

All settings live in `api/.env`. See `api/.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `MOSAIC_BACKUP_PASSPHRASE` | — | **Required.** At least 12 characters. Keep it in a password manager. Without it a backup cannot be restored. |
| `BACKUP_DIR` | `$MOSAIC_ROOT/backups/archive` | Local folder for backup files. |
| `MOSAIC_BACKUP_KEEP` | `14` | How many backups to keep, locally and in the bucket. Older ones are pruned after each successful run. |
| `MOSAIC_S3_ENDPOINT` | — | Endpoint, for example `https://<account>.r2.cloudflarestorage.com` or `https://s3.eu-west-1.amazonaws.com`. |
| `MOSAIC_S3_BUCKET` | — | Bucket name. |
| `MOSAIC_S3_REGION` | `auto` | SigV4 region (`auto` for R2). |
| `MOSAIC_S3_PREFIX` | `mosaic/` | Key prefix inside the bucket. |
| `MOSAIC_S3_ACCESS_KEY_ID` / `MOSAIC_S3_SECRET_ACCESS_KEY` | — | Credentials. Grant this key access to one bucket only. |

Upload turns on when the endpoint, bucket and both keys are all set.

The S3 client is a small SigV4 implementation with path-style URLs and no SDK dependency. It has been checked against AWS S3, Cloudflare R2, Backblaze B2, MinIO and Wasabi.

## Use

```bash
cd api
node --experimental-strip-types src/cli.ts backup        # snapshot, encrypt, store, upload, prune
node --experimental-strip-types src/cli.ts backup-list   # local and remote backups, newest first
```

Run it nightly with cron or a systemd timer:

```cron
15 3 * * *  cd /srv/mosaic/api && node --experimental-strip-types src/cli.ts backup >> /var/log/mosaic-backup.log 2>&1
```

## Restore

```bash
# by name (looked up locally), by path, or from the bucket
node --experimental-strip-types src/cli.ts restore mosaic-20261120T031500Z.db.gz.enc --to /tmp/restored.db
node --experimental-strip-types src/cli.ts restore s3:mosaic-20261120T031500Z.db.gz.enc --to /tmp/restored.db
```

`restore` decrypts and decompresses the backup, then runs `PRAGMA integrity_check` on the result. It never touches the live database and refuses to overwrite an existing file.

To switch over, stop the API, move the restored file to `MOSAIC_DB`, then start the API again.

## Threat model

- **The bucket provider sees only ciphertext.** It learns the file names and sizes.
- **The passphrase is never written to disk** by Mosaic and never leaves the server.
- **Losing the passphrase means losing the backups.** There is no recovery key.
- **Backups do not include `DATA_DIR/media`** (photos and receipts). Sync that folder separately, for example with `rclone` and its own encryption.
