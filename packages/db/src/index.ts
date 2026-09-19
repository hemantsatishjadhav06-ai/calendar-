import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@cadence/config';

export * from '@prisma/client';
export { tenantClient, type TenantPrisma } from './tenant-client.js';
// Pothos runtime datamodel + types (the query-compiler client strips Prisma.dmmf).
export { getDatamodel } from './pothos-types.js';
export type { default as PrismaTypes } from './pothos-types.js';

const g = globalThis as any;

/**
 * Each client connects through the `pg` driver adapter (Prisma driver adapters, GA in Prisma 6).
 * This removes the native query-engine binary entirely — smaller images, faster cold starts, and
 * a single connection per interactive transaction, which is exactly what the RLS `set_config`
 * mechanism in tenant-client.ts relies on.
 */
const makeClient = (connectionString: string, log?: ('warn' | 'error')[]): PrismaClient =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString }), ...(log ? { log } : {}) });

/** RLS-enforced role (`relay`). Used by the API after wrapping with tenantClient(). */
export const prismaApp: PrismaClient = g.__prismaApp ?? (g.__prismaApp = makeClient(env.DATABASE_URL, env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']));

/** BYPASSRLS role (`relay_admin`). Used by workers that legitimately span tenants (dispatcher, collectors). Always filter by organizationId in code. */
export const prismaAdmin: PrismaClient = g.__prismaAdmin ?? (g.__prismaAdmin = makeClient(env.DATABASE_URL_ADMIN));

/** Vault role (`relay_vault`). The only client allowed to read ChannelCredential. Lives in @cadence/token-vault only. */
export const prismaVault: PrismaClient = g.__prismaVault ?? (g.__prismaVault = makeClient(env.DATABASE_URL_VAULT));

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
