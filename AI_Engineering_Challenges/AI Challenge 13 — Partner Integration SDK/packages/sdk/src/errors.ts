/**
 * Base error class for all errors thrown by the InsuranceSDK.
 */
export class InsuranceSDKError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when client-side or server-side validation fails.
 * Exposes `fields` with field-level validation error messages.
 */
export class ValidationError extends InsuranceSDKError {
  public readonly fields: Record<string, string>;

  constructor(
    message: string,
    fields: Record<string, string>,
    statusCode?: number
  ) {
    super(message, 'VALIDATION_ERROR', statusCode);
    this.fields = { ...fields };
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when authentication fails (invalid API key, missing token, or unrecoverable 401).
 */
export class AuthError extends InsuranceSDKError {
  constructor(message: string, statusCode = 401) {
    super(message, 'AUTH_ERROR', statusCode);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a network failure or request timeout occurs after all retry attempts.
 */
export class NetworkError extends InsuranceSDKError {
  public readonly isTimeout: boolean;
  public readonly attempts: number;
  public readonly causeError?: unknown;

  constructor(
    message: string,
    options: { isTimeout?: boolean; attempts?: number; cause?: unknown } = {}
  ) {
    super(message, options.isTimeout ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR');
    this.isTimeout = options.isTimeout ?? false;
    this.attempts = options.attempts ?? 1;
    this.causeError = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the API returns a non-2xx error response (e.g., 404 Not Found, 500 Internal Error, or exhausted 503).
 */
export class ApiError extends InsuranceSDKError {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code = 'API_ERROR',
    details?: unknown
  ) {
    super(message, code, statusCode);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
