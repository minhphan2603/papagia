import { AuthTokenResponseDto } from '@insurtech/common';

export type TokenExchangeFn = (apiKey: string) => Promise<AuthTokenResponseDto>;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Manages JWT token acquisition, caching, proactive expiry detection,
 * and concurrent refresh deduplication.
 */
export class TokenManager {
  private readonly apiKey: string;
  private readonly exchangeFn: TokenExchangeFn;
  private readonly refreshBufferMs: number;
  private cachedToken: CachedToken | null = null;
  private inFlightRefresh: Promise<string> | null = null;

  constructor(
    apiKey: string,
    exchangeFn: TokenExchangeFn,
    refreshBufferSeconds = 30
  ) {
    this.apiKey = apiKey;
    this.exchangeFn = exchangeFn;
    this.refreshBufferMs = refreshBufferSeconds * 1000;
  }

  /**
   * Returns a valid JWT access token, acquiring or refreshing it if missing or expired.
   */
  public async getValidToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.cachedToken &&
      !this.isExpired(this.cachedToken)
    ) {
      return this.cachedToken.accessToken;
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.fetchNewToken().finally(() => {
      this.inFlightRefresh = null;
    });

    return this.inFlightRefresh;
  }

  /**
   * Clears the currently cached token, forcing the next request to re-authenticate.
   */
  public invalidate(): void {
    this.cachedToken = null;
  }

  /**
   * Returns true if a token is currently cached and not expired.
   */
  public hasValidCachedToken(): boolean {
    return this.cachedToken !== null && !this.isExpired(this.cachedToken);
  }

  private isExpired(token: CachedToken): boolean {
    const now = Date.now();
    return now + this.refreshBufferMs >= token.expiresAtMs;
  }

  private async fetchNewToken(): Promise<string> {
    const response = await this.exchangeFn(this.apiKey);
    const parsedExpiresAt = Date.parse(response.expiresAt);
    const expiresAtMs = Number.isFinite(parsedExpiresAt)
      ? parsedExpiresAt
      : Date.now() + response.expiresIn * 1000;

    this.cachedToken = {
      accessToken: response.accessToken,
      expiresAtMs,
    };

    return response.accessToken;
  }
}
