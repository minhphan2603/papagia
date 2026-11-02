import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import {
  ApiErrorResponseDto,
  AuthTokenResponseDto,
  ClaimStatus,
  CreateClaimRequestDto,
  DocumentType,
  UploadDocumentRequestDto,
  validateCreateClaimPayload,
  validateDocumentType,
  validateListClaimsQuery,
} from '@insurtech/common';
import { isValidApiKey, signJwt, verifyJwt } from './auth';
import { InMemoryStore } from './store';

export interface MockServerOptions {
  /** Port to listen on (0 for random available port in tests, default: 3000) */
  port?: number;
  /** Minimum simulated latency in milliseconds (default: 200) */
  minDelayMs?: number;
  /** Maximum simulated latency in milliseconds (default: 500) */
  maxDelayMs?: number;
  /** Probability (0.0 to 1.0) of returning a simulated 503 transient failure (default: 0.1) */
  failureRate?: number;
  /** JWT token expiration time in seconds (default: 3600 = 1 hour) */
  tokenExpiresInSeconds?: number;
  /** JWT signing secret */
  jwtSecret?: string;
  /** Whether to seed initial claim CLM-001 (default: true) */
  seedInitialData?: boolean;
  /**
   * Optional automatic status progression for newly created claims
   * (`PENDING` -> `IN_REVIEW` -> `APPROVED`) to demonstrate status polling.
   */
  autoProgressStatus?: boolean;
  /** Step interval in ms for auto status progression (default: 2000ms) */
  autoProgressIntervalMs?: number;
}

export class MockApiServer {
  public readonly store: InMemoryStore;
  private server: http.Server;
  private options: Required<MockServerOptions>;
  private activeTimers = new Set<NodeJS.Timeout>();
  private forcedFailuresRemaining = 0;

  constructor(options: MockServerOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      minDelayMs: options.minDelayMs ?? 200,
      maxDelayMs: options.maxDelayMs ?? 500,
      failureRate: options.failureRate ?? 0.1,
      tokenExpiresInSeconds: options.tokenExpiresInSeconds ?? 3600,
      jwtSecret: options.jwtSecret ?? 'insurtech-mock-jwt-secret-key-2026',
      seedInitialData: options.seedInitialData ?? true,
      autoProgressStatus: options.autoProgressStatus ?? false,
      autoProgressIntervalMs: options.autoProgressIntervalMs ?? 2000,
    };

    this.store = new InMemoryStore(this.options.seedInitialData);
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  /**
   * Starts listening on the configured port and returns the base URL.
   */
  public async start(portOverride?: number): Promise<string> {
    const targetPort = portOverride ?? this.options.port;
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        this.server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve(this.getBaseUrl());
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(targetPort, '127.0.0.1');
    });
  }

  /**
   * Gracefully stops the HTTP server and clears any background timers.
   */
  public async stop(): Promise<void> {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    if (!this.server.listening) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Returns the bound base URL (e.g. `http://127.0.0.1:3000`).
   */
  public getBaseUrl(): string {
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') {
      return `http://127.0.0.1:${this.options.port}`;
    }
    return `http://127.0.0.1:${addr.port}`;
  }

  /**
   * Test helper: forces the next `count` requests to fail with HTTP 503.
   */
  public forceNext503Failures(count: number): void {
    this.forcedFailuresRemaining = count;
  }

  /**
   * Dynamically updates simulation parameters at runtime.
   */
  public setSimulationOptions(
    partial: Partial<
      Pick<
        MockServerOptions,
        | 'minDelayMs'
        | 'maxDelayMs'
        | 'failureRate'
        | 'tokenExpiresInSeconds'
        | 'autoProgressStatus'
        | 'autoProgressIntervalMs'
      >
    >
  ): void {
    Object.assign(this.options, partial);
  }

  private async simulateLatency(): Promise<void> {
    const { minDelayMs, maxDelayMs } = this.options;
    if (maxDelayMs <= 0) {
      return;
    }
    const delay =
      minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
    if (delay <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.activeTimers.delete(timer);
        resolve();
      }, delay);
      this.activeTimers.add(timer);
    });
  }

  private shouldSimulateTransientFailure(): boolean {
    if (this.forcedFailuresRemaining > 0) {
      this.forcedFailuresRemaining -= 1;
      return true;
    }
    if (this.options.failureRate <= 0) {
      return false;
    }
    return Math.random() < this.options.failureRate;
  }

  private sendJson(
    res: ServerResponse,
    statusCode: number,
    payload: unknown
  ): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  private sendError(
    res: ServerResponse,
    statusCode: number,
    code: ApiErrorResponseDto['error']['code'],
    message: string,
    fields?: Record<string, string>
  ): void {
    const errorPayload: ApiErrorResponseDto = {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
    };
    this.sendJson(res, statusCode, errorPayload);
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('INVALID_JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private scheduleAutoStatusProgression(claimId: string): void {
    if (!this.options.autoProgressStatus) {
      return;
    }

    const interval = this.options.autoProgressIntervalMs;
    const step1 = setTimeout(() => {
      this.activeTimers.delete(step1);
      const current = this.store.getClaim(claimId);
      if (current && current.status === 'PENDING') {
        this.store.updateClaimStatus(claimId, 'IN_REVIEW');
      }
    }, interval);

    const step2 = setTimeout(() => {
      this.activeTimers.delete(step2);
      const current = this.store.getClaim(claimId);
      if (current && current.status === 'IN_REVIEW') {
        this.store.updateClaimStatus(claimId, 'APPROVED');
      }
    }, interval * 2);

    this.activeTimers.add(step1);
    this.activeTimers.add(step2);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      // 1. Simulate realistic response time (200-500ms)
      await this.simulateLatency();

      // 2. Simulate transient failures (~10% return 503 Service Unavailable)
      if (this.shouldSimulateTransientFailure()) {
        this.sendError(
          res,
          503,
          'SERVICE_UNAVAILABLE',
          'Simulated transient failure (503 Service Unavailable). Please retry.'
        );
        return;
      }

      const method = req.method ?? 'GET';
      const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      // Route 1: POST /api/v1/auth/token
      if (method === 'POST' && pathname === '/api/v1/auth/token') {
        await this.handleAuthToken(req, res);
        return;
      }

      // All remaining /api/v1/* endpoints require a valid JWT Bearer token
      const authResult = verifyJwt(
        req.headers.authorization,
        this.options.jwtSecret
      );
      if (!authResult.valid) {
        const message =
          authResult.reason === 'TOKEN_EXPIRED'
            ? 'Authentication token has expired'
            : 'Missing or invalid authentication token';
        this.sendError(res, 401, 'UNAUTHORIZED', message);
        return;
      }

      // Route 2: POST /api/v1/claims
      if (method === 'POST' && pathname === '/api/v1/claims') {
        await this.handleCreateClaim(req, res);
        return;
      }

      // Route 3: GET /api/v1/claims
      if (method === 'GET' && pathname === '/api/v1/claims') {
        this.handleListClaims(parsedUrl, res);
        return;
      }

      // Match /api/v1/claims/:id
      const claimIdMatch = /^\/api\/v1\/claims\/([^/]+)$/.exec(pathname);
      if (claimIdMatch && method === 'GET') {
        const claimId = decodeURIComponent(claimIdMatch[1]);
        this.handleGetClaim(claimId, res);
        return;
      }

      // Match /api/v1/claims/:id/documents
      const docsMatch = /^\/api\/v1\/claims\/([^/]+)\/documents$/.exec(
        pathname
      );
      if (docsMatch) {
        const claimId = decodeURIComponent(docsMatch[1]);
        if (method === 'POST') {
          await this.handleUploadDocument(claimId, req, res);
          return;
        }
        if (method === 'GET') {
          this.handleListDocuments(claimId, res);
          return;
        }
      }

      this.sendError(
        res,
        404,
        'NOT_FOUND',
        `Endpoint ${method} ${pathname} not found`
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_JSON') {
        this.sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'Invalid JSON payload in request body',
          { _body: 'invalid JSON' }
        );
        return;
      }
      this.sendError(
        res,
        500,
        'INTERNAL_ERROR',
        'Unexpected internal server error'
      );
    }
  }

  private async handleAuthToken(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = (await this.readJsonBody(req)) as Record<string, unknown>;
    const headerApiKey = req.headers['x-api-key'];
    const apiKey =
      typeof body?.apiKey === 'string'
        ? body.apiKey
        : typeof headerApiKey === 'string'
          ? headerApiKey
          : undefined;

    if (!isValidApiKey(apiKey)) {
      this.sendError(
        res,
        401,
        'UNAUTHORIZED',
        'Invalid or missing API key (expected pk_test_xxx or pk_live_xxx)'
      );
      return;
    }

    const signed = signJwt(
      apiKey,
      this.options.tokenExpiresInSeconds,
      this.options.jwtSecret
    );

    const response: AuthTokenResponseDto = {
      accessToken: signed.token,
      tokenType: 'Bearer',
      expiresIn: signed.expiresIn,
      expiresAt: signed.expiresAt,
    };

    this.sendJson(res, 200, response);
  }

  private async handleCreateClaim(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await this.readJsonBody(req);
    const fieldErrors = validateCreateClaimPayload(body);

    if (Object.keys(fieldErrors).length > 0) {
      this.sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Claim request validation failed',
        fieldErrors
      );
      return;
    }

    const claim = this.store.createClaim(body as CreateClaimRequestDto);
    this.scheduleAutoStatusProgression(claim.id);
    this.sendJson(res, 201, claim);
  }

  private handleGetClaim(claimId: string, res: ServerResponse): void {
    const claim = this.store.getClaim(claimId);
    if (!claim) {
      this.sendError(
        res,
        404,
        'NOT_FOUND',
        `Claim with id '${claimId}' not found`
      );
      return;
    }
    this.sendJson(res, 200, claim);
  }

  private handleListClaims(parsedUrl: URL, res: ServerResponse): void {
    const statusParam = parsedUrl.searchParams.get('status') ?? undefined;
    const pageParam = parsedUrl.searchParams.get('page');
    const pageSizeParam = parsedUrl.searchParams.get('pageSize');

    const queryObj: Record<string, unknown> = {};
    if (statusParam !== undefined) {
      queryObj.status = statusParam;
    }
    if (pageParam !== null) {
      queryObj.page = Number(pageParam);
    }
    if (pageSizeParam !== null) {
      queryObj.pageSize = Number(pageSizeParam);
    }

    const fieldErrors = validateListClaimsQuery(queryObj);
    if (Object.keys(fieldErrors).length > 0) {
      this.sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Invalid query parameters',
        fieldErrors
      );
      return;
    }

    const result = this.store.listClaims({
      status: queryObj.status as ClaimStatus | undefined,
      page: queryObj.page as number | undefined,
      pageSize: queryObj.pageSize as number | undefined,
    });

    this.sendJson(res, 200, result);
  }

  private async handleUploadDocument(
    claimId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const claim = this.store.getClaim(claimId);
    if (!claim) {
      this.sendError(
        res,
        404,
        'NOT_FOUND',
        `Claim with id '${claimId}' not found`
      );
      return;
    }

    const body = (await this.readJsonBody(
      req
    )) as Partial<UploadDocumentRequestDto>;
    const fields: Record<string, string> = {
      ...validateDocumentType(body?.type),
    };

    if (
      !body?.contentBase64 ||
      typeof body.contentBase64 !== 'string' ||
      body.contentBase64.trim() === ''
    ) {
      fields.file = 'file content is required and must not be empty';
    }

    if (Object.keys(fields).length > 0) {
      this.sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Document upload validation failed',
        fields
      );
      return;
    }

    const fileBuffer = Buffer.from(body.contentBase64!, 'base64');
    if (fileBuffer.byteLength === 0) {
      this.sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'Document upload validation failed',
        { file: 'file content must not be empty' }
      );
      return;
    }

    const doc = this.store.addDocument(claimId, {
      type: body.type as DocumentType,
      fileName:
        typeof body.fileName === 'string' && body.fileName.trim() !== ''
          ? body.fileName.trim()
          : `${body.type}.bin`,
      mimeType:
        typeof body.mimeType === 'string' && body.mimeType.trim() !== ''
          ? body.mimeType.trim()
          : 'application/octet-stream',
      sizeBytes: fileBuffer.byteLength,
    });

    this.sendJson(res, 201, doc);
  }

  private handleListDocuments(claimId: string, res: ServerResponse): void {
    const docs = this.store.listDocuments(claimId);
    if (!docs) {
      this.sendError(
        res,
        404,
        'NOT_FOUND',
        `Claim with id '${claimId}' not found`
      );
      return;
    }
    this.sendJson(res, 200, docs);
  }
}
