import { Environment } from '@insurtech/common';
import { HttpClient } from './http-client';
import { ClaimsResource } from './resources/claims';
import { DocumentsResource } from './resources/documents';
import { validateSDKConfig } from './validator';

export interface InsuranceSDKConfig {
  /** Partner API key (e.g., 'pk_test_xxx' or 'pk_live_xxx') */
  apiKey: string;
  /** Target environment ('sandbox' or 'production') */
  environment: Environment;
  /** Request timeout in milliseconds (optional, default: 30000) */
  timeout?: number;
  /** Optional base URL override (defaults to http://127.0.0.1:3000 for sandbox) */
  baseUrl?: string;
  /** Maximum number of automatic retries on 503 / network failures (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds before retrying (default: 250) */
  retryBaseDelayMs?: number;
  /** Seconds before token expiry to proactively refresh JWT (default: 30) */
  tokenRefreshBufferSeconds?: number;
}

const DEFAULT_BASE_URLS: Record<Environment, string> = {
  sandbox: 'http://127.0.0.1:3000',
  production: 'https://api.insurtech.example.com',
};

/**
 * Main client for the Insurtech Partner Integration SDK.
 */
export class InsuranceSDK {
  public readonly claims: ClaimsResource;
  public readonly documents: DocumentsResource;
  private readonly httpClient: HttpClient;

  constructor(config: InsuranceSDKConfig) {
    validateSDKConfig(config);

    const baseUrl =
      config.baseUrl?.trim() ||
      process.env.INSURTECH_API_URL?.trim() ||
      DEFAULT_BASE_URLS[config.environment];

    this.httpClient = new HttpClient({
      baseUrl,
      apiKey: config.apiKey.trim(),
      timeoutMs: config.timeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 250,
      tokenRefreshBufferSeconds: config.tokenRefreshBufferSeconds ?? 30,
    });

    this.claims = new ClaimsResource(this.httpClient);
    this.documents = new DocumentsResource(this.httpClient);
  }

  /**
   * Stops any active background status polling timers.
   */
  public destroy(): void {
    this.claims.stopAllPolling();
  }
}
