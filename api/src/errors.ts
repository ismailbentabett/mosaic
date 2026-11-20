// One error type for the whole server. Routes turn it into { error, message } JSON.
export type ErrorCode =
  | 'google_not_connected' | 'google_auth_expired'
  | 'rule_violation' | 'not_found' | 'conflict' | 'bad_request' | 'upstream';

const STATUS: Record<ErrorCode, number> = {
  google_not_connected: 503, google_auth_expired: 503,
  rule_violation: 422, not_found: 404, conflict: 409, bad_request: 400, upstream: 502,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  extra: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }
  toJSON() { return { error: this.code, message: this.message, ...this.extra }; }
}

export const fail = (code: ErrorCode, message: string, extra?: Record<string, unknown>): never => {
  throw new AppError(code, message, extra);
};
