import { createYoga as create, useReadinessCheck } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { schema } from './schema/index.js';
import { buildContext } from './context.js';
import { DomainError } from '@cadence/domain';
import { ConnectorError } from '@cadence/connectors';
import { RateLimiter } from './rate-limit.js';

const limiter = new RateLimiter();

export function createYoga() {
  return create({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: process.env.NODE_ENV !== 'production',
    landingPage: false,
    maskedErrors: {
      maskError(error: any, message) {
        const orig = error?.originalError ?? error;
        if (orig instanceof DomainError) return new GraphQLError(orig.message, { extensions: { code: orig.code, field: orig.field, ...orig.meta } });
        if (orig instanceof ConnectorError) return new GraphQLError(orig.message, { extensions: { code: `CONNECTOR_${orig.code}` } });
        if (orig?.code === 'UNAUTHENTICATED') return new GraphQLError('Sign in required', { extensions: { code: 'UNAUTHENTICATED' } });
        if (orig?.name === 'ZodError') return new GraphQLError('Invalid input', { extensions: { code: 'VALIDATION', issues: orig.issues } });
        if (/Not authorized/.test(orig?.message ?? '')) return new GraphQLError('Not authorized', { extensions: { code: 'FORBIDDEN' } });
        if (process.env.NODE_ENV !== 'production') return new GraphQLError(orig?.message ?? message, { extensions: { code: 'INTERNAL', stack: orig?.stack } });
        return new GraphQLError(message, { extensions: { code: 'INTERNAL' } });
      },
    },
    context: async ({ req }: any) => {
      const rc = (req as any).rc ?? {};
      const ctx = buildContext(rc, req);
      if (ctx.isPublicApi && ctx.tenant) {
        const verdict = await limiter.check(ctx.apiKeyId!, ctx.tenant.entitlements);
        if (!verdict.ok) throw new GraphQLError('Rate limit exceeded', { extensions: { code: 'RATE_LIMITED', retryAfter: verdict.retryAfterSec, http: { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec), RateLimit: verdict.header } } } });
      }
      return ctx;
    },
    plugins: [useReadinessCheck({ endpoint: '/graphql/ready', check: async () => true })],
  });
}
