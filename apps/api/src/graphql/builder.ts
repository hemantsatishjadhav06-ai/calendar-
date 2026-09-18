import SchemaBuilder from '@pothos/core';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import ErrorsPlugin from '@pothos/plugin-errors';
import ComplexityPlugin from '@pothos/plugin-complexity';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';
import { prismaApp, getDatamodel, type PrismaClient, type PrismaTypes } from '@cadence/db';
import { can, hasApiScope, type Action } from '@cadence/domain';
import type { GqlContext } from './context.js';

export const builder = new SchemaBuilder<{
  Context: GqlContext;
  PrismaTypes: PrismaTypes;
  AuthScopes: { user: boolean; admin: boolean; apiScope: string; can: [Action, string | undefined] };
  Scalars: { DateTime: { Input: Date; Output: Date }; JSON: { Input: unknown; Output: unknown } };
  DefaultFieldNullability: false;
}>({
  plugins: [ScopeAuthPlugin, PrismaPlugin, RelayPlugin, ErrorsPlugin, ComplexityPlugin],
  defaultFieldNullability: false,
  prisma: {
    client: ctx => (ctx.db ?? prismaApp) as unknown as PrismaClient,
    dmmf: getDatamodel(),
    exposeDescriptions: false,
    filterConnectionTotalCount: true,
  },
  scopeAuth: {
    authScopes: ctx => ({
      user: !!ctx.tenant,
      admin: !!ctx.tenant && (ctx.tenant.role === 'OWNER' || ctx.tenant.role === 'ADMIN'),
      apiScope: (scope: string) => !!ctx.tenant && hasApiScope(ctx.tenant, scope),
      can: ([action, channelId]: [Action, string | undefined]) => !!ctx.tenant && can(ctx.tenant, action, channelId),
    }),
    unauthorizedError: () => new Error('Not authorized'),
  },
  errors: { defaultTypes: [] },
  complexity: { defaultComplexity: 1, defaultListMultiplier: 10, limit: { complexity: 2000, depth: 10, breadth: 100 } },
  relay: { cursorType: 'String', nodesOnConnection: true },
});

builder.addScalarType('DateTime', GraphQLDateTime);
builder.addScalarType('JSON', GraphQLJSON);

builder.queryType({});
builder.mutationType({});

/** Marker for fields exposed in the public API. Build step emits public.graphql from this set. */
export const publicFields = new Set<string>();
export const markPublic = (typeName: string, field: string) => publicFields.add(`${typeName}.${field}`);
