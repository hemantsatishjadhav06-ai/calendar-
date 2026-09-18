export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'ENTITLEMENT' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL';

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public field?: string, public meta?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
  }
}
export const forbidden = (m = 'You do not have permission to do that') => new DomainError('FORBIDDEN', m);
export const notFound = (what = 'Resource') => new DomainError('NOT_FOUND', `${what} not found`);
export const validation = (m: string, field?: string) => new DomainError('VALIDATION', m, field);
export const entitlement = (m: string, feature?: string) => new DomainError('ENTITLEMENT', m, undefined, { feature });
