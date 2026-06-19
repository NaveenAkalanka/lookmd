/**
 * Maps internal errors to HTTP status codes and the shared `ApiError` shape, so
 * route handlers can just throw and the error handler does the translation.
 */

import type { ApiError, ApiErrorCode } from '@lookmd/shared';
import { PathValidationError, type PathErrorCode } from './security/paths.ts';

/** An error carrying an explicit HTTP status and API error code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const PATH_ERROR_STATUS: Record<PathErrorCode, number> = {
  INVALID_PATH: 400,
  DISALLOWED_TYPE: 400,
  OUTSIDE_BASE: 403,
  OUTSIDE_ROOT: 403,
  SYMLINK_ESCAPE: 403,
};

export function toApiError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  if (err instanceof PathValidationError) {
    return {
      status: PATH_ERROR_STATUS[err.code],
      body: { error: err.message, code: err.code },
    };
  }
  return { status: 500, body: { error: 'internal server error', code: 'IO_ERROR' } };
}
