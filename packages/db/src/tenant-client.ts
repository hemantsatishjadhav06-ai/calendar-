import { Prisma, PrismaClient } from '@prisma/client';
import { isUuid } from './index.js';

/**
 * Returns a Prisma client whose every operation runs inside a transaction that sets `app.org_id`,
 * which the RLS policies compare against. Use one per request.
 *
 * For multi-statement work use `tx(orgId, fn)` which sets the variable once for the whole transaction.
 */
export function tenantClient(base: PrismaClient, organizationId: string) {
  if (!isUuid(organizationId)) throw new Error('organizationId must be a UUID');
  const ext = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return base.$transaction(async tx => {
            await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`;
            // Prisma routes `query` to the interactive transaction when called within $transaction callback
            return (query as any)(args);
          });
        },
      },
    },
  });
  return Object.assign(ext, {
    /** Run several operations in one RLS-scoped transaction. */
    tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      return base.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${organizationId}, true)`;
        return fn(tx);
      });
    },
    organizationId,
  });
}
export type TenantPrisma = ReturnType<typeof tenantClient>;
