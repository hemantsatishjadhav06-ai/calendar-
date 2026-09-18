import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorCode } from '@cadence/domain';

// HTTP status for each domain error code. Mirrors what the GraphQL layer (graphql/yoga.ts) puts in
// `extensions.code`, so REST and GraphQL clients get consistent semantics.
const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED, // 401
  FORBIDDEN: HttpStatus.FORBIDDEN, // 403
  NOT_FOUND: HttpStatus.NOT_FOUND, // 404
  VALIDATION: HttpStatus.BAD_REQUEST, // 400
  ENTITLEMENT: HttpStatus.PAYMENT_REQUIRED, // 402
  CONFLICT: HttpStatus.CONFLICT, // 409
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS, // 429
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR, // 500
};

/**
 * Turns errors thrown by REST controllers into proper HTTP responses. Without this, a DomainError
 * (e.g. "an account with this email already exists") or a Zod parse error thrown from a controller
 * is unhandled and Nest returns a bare 500 — which is exactly what /auth/signup did for the
 * conflict and short-password cases.
 *
 * DomainError / ZodError are matched structurally (by `name`) rather than with `instanceof`, since
 * instanceof is unreliable when a class is loaded from more than one compiled bundle.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const err = exception as {
      name?: string;
      message?: string;
      code?: string;
      field?: string;
      meta?: Record<string, unknown>;
      issues?: Array<{ path: (string | number)[]; message: string }>;
    };

    // DomainError → mapped status + structured body
    if (err?.name === 'DomainError' && typeof err.code === 'string' && err.code in STATUS) {
      const status = STATUS[err.code as ErrorCode];
      return res.status(status).json({ statusCode: status, code: err.code, message: err.message, field: err.field, ...(err.meta ?? {}) });
    }

    // ZodError (from `.parse()` in controllers) → 400 with the first issue
    if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
      const first = err.issues[0];
      return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, code: 'VALIDATION', message: first?.message ?? 'Invalid input', field: first?.path?.join('.') || undefined });
    }

    // Nest HttpExceptions keep their own status/body (e.g. the 401 from login)
    if (exception instanceof HttpException) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }

    // Anything else is a genuine server fault
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
  }
}
