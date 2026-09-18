import { prismaVault, type Channel } from '@cadence/db';
import { keyProvider, open, seal } from './crypto.js';
import { withLock } from './lock.js';

export { withLock } from './lock.js';
export { seal, open, keyProvider } from './crypto.js';

/** Decrypted credentials — in memory only, never logged, never returned by GraphQL. */
export interface Creds {
  accessToken: string;
  refreshToken?: string;
  tokenType: 'bearer' | 'dpop' | 'app_password' | 'oauth-session' | 'apikey';
  accessExpiresAt?: Date;
  refreshExpiresAt?: Date;
  scopes?: string[];
  extra: Record<string, any>;
}

export type Refresher = (creds: Creds, channel: Channel) => Promise<Creds>;

export const tokenVault = {
  async store(channelId: string, creds: Creds) {
    const kp = keyProvider();
    const { plaintext: dek, wrapped } = await kp.generateDataKey(channelId);
    // Prisma 6 maps `Bytes` to `Uint8Array<ArrayBuffer>`; copy each Buffer into a
    // fresh ArrayBuffer-backed view so the (ArrayBufferLike) Buffer type is accepted.
    const toBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
    try {
      const data = {
        accessTokenEnc: toBytes(seal(creds.accessToken, dek)),
        refreshTokenEnc: creds.refreshToken ? toBytes(seal(creds.refreshToken, dek)) : null,
        extraEnc: toBytes(seal(JSON.stringify(creds.extra ?? {}), dek)),
        dekEnc: toBytes(wrapped),
        tokenType: creds.tokenType,
        scopes: creds.scopes ?? [],
        accessExpiresAt: creds.accessExpiresAt ?? null,
        refreshExpiresAt: creds.refreshExpiresAt ?? null,
        lastRefreshedAt: new Date(),
        refreshFailures: 0,
      };
      await prismaVault.channelCredential.upsert({ where: { channelId }, create: { channelId, ...data }, update: data });
    } finally { dek.fill(0); }
  },

  async load(channelId: string): Promise<Creds> {
    const row = await prismaVault.channelCredential.findUniqueOrThrow({ where: { channelId } });
    const dek = await keyProvider().unwrap(Buffer.from(row.dekEnc), channelId);
    try {
      return {
        accessToken: open(Buffer.from(row.accessTokenEnc), dek),
        refreshToken: row.refreshTokenEnc ? open(Buffer.from(row.refreshTokenEnc), dek) : undefined,
        tokenType: row.tokenType as Creds['tokenType'],
        accessExpiresAt: row.accessExpiresAt ?? undefined,
        refreshExpiresAt: row.refreshExpiresAt ?? undefined,
        scopes: row.scopes,
        extra: JSON.parse(open(Buffer.from(row.extraEnc), dek)),
      };
    } finally { dek.fill(0); }
  },

  /**
   * Load and transparently refresh when the access token expires within `skewMs`.
   * Serialised per channel: X, Pinterest and Bluesky rotate refresh tokens, so two concurrent refreshes would kill the session.
   */
  async forChannel(channelId: string, channel: Channel, refresh: Refresher, skewMs = 24 * 3600_000): Promise<Creds> {
    const creds = await this.load(channelId);
    if (!creds.accessExpiresAt || creds.accessExpiresAt.getTime() - Date.now() > skewMs) return creds;
    return withLock(`token-refresh:${channelId}`, 30_000, async () => {
      const fresh = await this.load(channelId);
      if (fresh.accessExpiresAt && fresh.accessExpiresAt.getTime() - Date.now() > skewMs) return fresh;
      const next = await refresh(fresh, channel);
      await this.store(channelId, next);
      return next;
    });
  },

  async delete(channelId: string) {
    await prismaVault.channelCredential.deleteMany({ where: { channelId } });
  },

  async markRefreshFailure(channelId: string) {
    await prismaVault.channelCredential.update({ where: { channelId }, data: { refreshFailures: { increment: 1 } } });
  },

  // Opaque blobs for things like Bluesky OAuth sessions (keyed by `bsky:<did>`) or Integration credentials.
  async storeRaw(key: string, value: string) {
    const kp = keyProvider(); const { plaintext: dek, wrapped } = await kp.generateDataKey(key);
    try { await prismaVault.$executeRaw`INSERT INTO "VaultBlob" (key, value_enc, dek_enc, updated_at) VALUES (${key}, ${seal(value, dek)}, ${wrapped}, now()) ON CONFLICT (key) DO UPDATE SET value_enc = EXCLUDED.value_enc, dek_enc = EXCLUDED.dek_enc, updated_at = now()`; }
    finally { dek.fill(0); }
  },
  async loadRaw(key: string): Promise<string | undefined> {
    const rows = await prismaVault.$queryRaw<{ value_enc: Buffer; dek_enc: Buffer }[]>`SELECT value_enc, dek_enc FROM "VaultBlob" WHERE key = ${key}`;
    if (!rows.length) return undefined;
    const dek = await keyProvider().unwrap(Buffer.from(rows[0].dek_enc), key);
    try { return open(Buffer.from(rows[0].value_enc), dek); } finally { dek.fill(0); }
  },
  async deleteRaw(key: string) { await prismaVault.$executeRaw`DELETE FROM "VaultBlob" WHERE key = ${key}`; },
};
