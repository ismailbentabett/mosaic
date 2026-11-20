// Minimal S3 client (PUT, GET, LIST v2, DELETE) signed with AWS Signature V4.
// No SDK: node:crypto + fetch only. Works with AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi
// and any other S3-compatible store. Path-style URLs: <endpoint>/<bucket>/<key>.
import { createHash, createHmac } from 'node:crypto';

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();

/** RFC 3986 encoding as SigV4 wants it; '/' is kept for object keys. */
export const uriEncode = (s: string, keepSlash = false) => {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? e.replace(/%2F/g, '/') : e;
};

export const signingKey = (secret: string, date: string, region: string, service: string) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');

type SignInput = {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
};

/** Returns the headers to send, including Authorization. Exported for the known-answer test. */
export const signV4 = (i: SignInput): Record<string, string> => {
  const amzDate = i.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...i.headers, host: i.url.host, 'x-amz-date': amzDate };
  if (i.service === 's3') headers['x-amz-content-sha256'] = i.payloadHash;
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    i.method,
    i.url.pathname.split('/').map((p) => uriEncode(decodeURIComponent(p))).join('/') || '/',
    query,
    names.map((n) => `${n}:${lower[n]}\n`).join(''),
    names.join(';'),
    i.payloadHash,
  ].join('\n');
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const sig = createHmac('sha256', signingKey(i.secretAccessKey, date, i.region, i.service)).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`,
  };
};

export class S3 {
  private c: S3Config;
  private fetchFn: typeof fetch;
  constructor(c: S3Config, fetchFn: typeof fetch = fetch) {
    this.c = c;
    this.fetchFn = fetchFn;
  }

  private async send(method: string, key: string, body?: Buffer, query: Record<string, string> = {}) {
    const base = this.c.endpoint.replace(/\/+$/, '');
    const url = new URL(`${base}/${uriEncode(this.c.bucket)}${key ? `/${uriEncode(key, true)}` : ''}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const payload = body ?? Buffer.alloc(0);
    const headers = signV4({
      method, url, payloadHash: sha256(payload), region: this.c.region, service: 's3',
      accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey, now: new Date(),
      headers: body ? { 'content-type': 'application/octet-stream', 'content-length': String(payload.length) } : {},
    });
    delete headers.host;
    const res = await this.fetchFn(url, { method, headers, body: body ? new Uint8Array(payload) : undefined });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? res.statusText;
      throw new Error(`S3 ${method} ${key || '/'} failed: ${res.status} ${code}`);
    }
    return res;
  }

  async put(key: string, body: Buffer) { await this.send('PUT', key, body); }
  async get(key: string) { return Buffer.from(await (await this.send('GET', key)).arrayBuffer()); }
  async delete(key: string) { await this.send('DELETE', key); }

  /** Keys under a prefix with size and last-modified, oldest first. Follows continuation tokens. */
  async list(prefix: string) {
    const out: { key: string; size: number; modified: string }[] = [];
    let token: string | undefined;
    do {
      const q: Record<string, string> = { 'list-type': '2', prefix };
      if (token) q['continuation-token'] = token;
      const xml = await (await this.send('GET', '', undefined, q)).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const tag = (t: string) => m[1].match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? '';
        out.push({ key: decodeXml(tag('Key')), size: Number(tag('Size')), modified: tag('LastModified') });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)</)?.[1] : undefined;
    } while (token);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
