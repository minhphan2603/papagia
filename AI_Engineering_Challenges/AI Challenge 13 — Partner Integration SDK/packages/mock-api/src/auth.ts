import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface JwtVerifyResult {
  valid: boolean;
  reason?:
    'MISSING_TOKEN' | 'MALFORMED_TOKEN' | 'INVALID_SIGNATURE' | 'TOKEN_EXPIRED';
  payload?: JwtPayload;
}

const DEFAULT_SECRET = 'insurtech-mock-jwt-secret-key-2026';

/**
 * Validates whether an API key is recognized by the mock server.
 * Accepts keys starting with `pk_test_` or `pk_live_` with at least 3 characters after prefix.
 */
export function isValidApiKey(apiKey: unknown): apiKey is string {
  if (typeof apiKey !== 'string') {
    return false;
  }
  const trimmed = apiKey.trim();
  return /^pk_(test|live)_[a-zA-Z0-9_-]{3,}$/.test(trimmed);
}

/**
 * Signs an HS256 JWT token that expires in `expiresInSeconds` (default: 3600s = 1 hour).
 */
export function signJwt(
  apiKey: string,
  expiresInSeconds = 3600,
  secret = DEFAULT_SECRET
): { token: string; expiresIn: number; expiresAt: string } {
  const token = jwt.sign({ sub: apiKey }, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });

  const expiresAt = new Date(
    Date.now() + expiresInSeconds * 1000
  ).toISOString();

  return {
    token,
    expiresIn: expiresInSeconds,
    expiresAt,
  };
}

/**
 * Verifies a Bearer JWT token's format, cryptographic signature, and expiration time.
 */
export function verifyJwt(
  authHeader: string | undefined,
  secret = DEFAULT_SECRET
): JwtVerifyResult {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, reason: 'MISSING_TOKEN' };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { valid: false, reason: 'MISSING_TOKEN' };
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload;
    return { valid: true, payload };
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return { valid: false, reason: 'TOKEN_EXPIRED' };
    }
    if (
      error instanceof JsonWebTokenError &&
      error.message === 'invalid signature'
    ) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    return { valid: false, reason: 'MALFORMED_TOKEN' };
  }
}
