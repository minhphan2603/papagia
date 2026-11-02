import http from 'http';
import https from 'https';
import { URL } from 'url';
import { ApiErrorResponseDto, AuthTokenResponseDto } from '@insurtech/common';
import {
  ApiError,
  AuthError,
  InsuranceSDKError,
  NetworkError,
  ValidationError,
} from './errors';
import { TokenManager } from './token-manager';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  tokenRefreshBufferSeconds?: number;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Explicit flag indicating a chunked document upload request */
  isUpload?: boolean;
  /** Optional upload progress callback (0..100) */
  onProgress?: (percent: number) => void;
}

/**
 * Default chunk size (4 KB) used to determine the number of upload steps based on payload size.
 */
const UPLOAD_CHUNK_SIZE_BYTES = 4 * 1024;

interface RawHttpResponse {
  statusCode: number;
  bodyText: string;
}

/**
 * Internal HTTP client providing:
 * - Automatic JWT authentication & reactive 401 token refresh
 * - Automatic retry with exponential backoff + jitter for 503 & transient network errors
 * - Request timeout handling
 * - Chunked upload progress reporting
 */
export class HttpClient {
  public readonly tokenManager: TokenManager;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.retryBaseDelayMs = options.retryBaseDelayMs;

    this.tokenManager = new TokenManager(
      options.apiKey,
      (apiKey) => this.exchangeApiKeyForToken(apiKey),
      options.tokenRefreshBufferSeconds ?? 30
    );
  }

  /**
   * Executes an authenticated HTTP request with automatic token management and retry backoff.
   */
  public async request<T>(options: HttpRequestOptions): Promise<T> {
    let token = await this.tokenManager.getValidToken(false);

    try {
      return await this.executeWithRetry<T>(options, token);
    } catch (error) {
      // If the server rejected our token with 401 (e.g. expired on server side),
      // invalidate the cached token, refresh once, and replay the request.
      if (error instanceof AuthError && error.statusCode === 401) {
        this.tokenManager.invalidate();
        token = await this.tokenManager.getValidToken(true);
        return await this.executeWithRetry<T>(options, token);
      }
      throw error;
    }
  }

  private async exchangeApiKeyForToken(
    apiKey: string
  ): Promise<AuthTokenResponseDto> {
    return this.executeWithRetry<AuthTokenResponseDto>(
      {
        method: 'POST',
        path: '/api/v1/auth/token',
        body: { apiKey },
      },
      undefined
    );
  }

  private async executeWithRetry<T>(
    options: HttpRequestOptions,
    bearerToken?: string
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const raw = await this.performSingleHttpRequest(options, bearerToken);

        // Success (2xx)
        if (raw.statusCode >= 200 && raw.statusCode < 300) {
          if (options.isUpload && options.onProgress) {
            options.onProgress(100);
          }
          return (raw.bodyText ? JSON.parse(raw.bodyText) : {}) as T;
        }

        // Transient server failure (503 Service Unavailable) -> retry if attempts remain
        if (raw.statusCode === 503 && attempt <= this.maxRetries) {
          await this.sleepBackoff(attempt - 1);
          continue;
        }

        // Convert non-2xx HTTP response into a typed SDK error
        throw this.mapHttpError(raw.statusCode, raw.bodyText);
      } catch (error) {
        // Re-throw typed non-retryable errors immediately
        if (
          error instanceof ValidationError ||
          error instanceof AuthError ||
          error instanceof ApiError
        ) {
          throw error;
        }

        // Network or timeout error -> retry if attempts remain
        if (error instanceof NetworkError) {
          if (attempt <= this.maxRetries) {
            await this.sleepBackoff(attempt - 1);
            continue;
          }
          throw new NetworkError(error.message, {
            isTimeout: error.isTimeout,
            attempts: attempt,
            cause: error.causeError,
          });
        }

        if (error instanceof InsuranceSDKError) {
          throw error;
        }

        throw new NetworkError(
          error instanceof Error ? error.message : 'Unexpected network error',
          { attempts: attempt, cause: error }
        );
      }
    }
  }

  private async sleepBackoff(retryIndex: number): Promise<void> {
    const exponential = this.retryBaseDelayMs * Math.pow(2, retryIndex);
    const jitter = Math.floor(
      Math.random() * Math.max(1, this.retryBaseDelayMs * 0.25)
    );
    const delayMs = exponential + jitter;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  private mapHttpError(
    statusCode: number,
    bodyText: string
  ): InsuranceSDKError {
    let parsed: Partial<ApiErrorResponseDto> | undefined;
    try {
      parsed = bodyText
        ? (JSON.parse(bodyText) as Partial<ApiErrorResponseDto>)
        : undefined;
    } catch {
      parsed = undefined;
    }

    const message =
      parsed?.error?.message || `HTTP request failed with status ${statusCode}`;
    const code = parsed?.error?.code || 'API_ERROR';
    const fields = parsed?.error?.fields;

    if (statusCode === 400) {
      return new ValidationError(message, fields ?? {}, 400);
    }

    if (statusCode === 401 || statusCode === 403) {
      return new AuthError(message, statusCode);
    }

    return new ApiError(message, statusCode, code, parsed);
  }

  private performSingleHttpRequest(
    options: HttpRequestOptions,
    bearerToken?: string
  ): Promise<RawHttpResponse> {
    return new Promise((resolve, reject) => {
      const targetUrl = new URL(options.path, `${this.baseUrl}/`);
      if (options.query) {
        for (const [key, value] of Object.entries(options.query)) {
          if (value !== undefined) {
            targetUrl.searchParams.set(key, String(value));
          }
        }
      }

      const bodyBuffer =
        options.body !== undefined
          ? Buffer.from(JSON.stringify(options.body), 'utf8')
          : undefined;

      const headers: Record<string, string | number> = {
        Accept: 'application/json',
      };

      if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
      }

      if (bodyBuffer) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = bodyBuffer.byteLength;
      }

      const transport = targetUrl.protocol === 'https:' ? https : http;
      let settled = false;

      const req = transport.request(
        targetUrl,
        {
          method: options.method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on('end', () => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timeoutTimer);
            const bodyText = Buffer.concat(chunks).toString('utf8');
            resolve({
              statusCode: res.statusCode ?? 500,
              bodyText,
            });
          });
        }
      );

      const timeoutTimer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        req.destroy();
        reject(
          new NetworkError(`Request timed out after ${this.timeoutMs}ms`, {
            isTimeout: true,
          })
        );
      }, this.timeoutMs);

      req.on('error', (err) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        reject(
          new NetworkError(`Network request failed: ${err.message}`, {
            isTimeout: false,
            cause: err,
          })
        );
      });

      if (!bodyBuffer) {
        req.end();
        return;
      }

      // For upload requests, determine step count from payload byte size and stream chunks
      if (options.isUpload && bodyBuffer.byteLength > 0) {
        const totalBytes = bodyBuffer.byteLength;
        const steps = Math.max(
          1,
          Math.ceil(totalBytes / UPLOAD_CHUNK_SIZE_BYTES)
        );
        const chunkSize = Math.ceil(totalBytes / steps);
        let offset = 0;
        let lastReportedPercent = -1;

        const reportProgress = (percent: number) => {
          if (options.onProgress && percent !== lastReportedPercent) {
            lastReportedPercent = percent;
            options.onProgress(percent);
          }
        };

        reportProgress(0);

        const writeNextChunk = () => {
          if (settled) {
            return;
          }
          const end = Math.min(offset + chunkSize, totalBytes);
          const slice = bodyBuffer.subarray(offset, end);
          offset = end;

          // Report up to 90% while streaming request chunks; 100% is reported when server acknowledges
          const percent = Math.min(90, Math.round((offset / totalBytes) * 90));
          reportProgress(percent);

          if (offset < totalBytes) {
            const canContinue = req.write(slice);
            if (canContinue) {
              setImmediate(writeNextChunk);
            } else {
              req.once('drain', writeNextChunk);
            }
          } else {
            req.end(slice);
          }
        };

        writeNextChunk();
      } else {
        req.end(bodyBuffer);
      }
    });
  }
}
