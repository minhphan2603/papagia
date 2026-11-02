import {
  ClaimDto,
  ClaimStatus,
  CreateClaimRequestDto,
  ListClaimsQueryDto,
  PaginatedResponseDto,
} from '@insurtech/common';
import { ValidationError } from '../errors';
import { HttpClient } from '../http-client';
import {
  assertValidClaimId,
  assertValidCreateClaim,
  assertValidListClaimsQuery,
} from '../validator';

export type ClaimStatusChangeCallback = (
  newStatus: ClaimStatus,
  claim: ClaimDto
) => void;

export interface StatusPollingOptions {
  /** Polling interval in milliseconds (default: 1000ms) */
  intervalMs?: number;
  /** Optional error handler if a poll request fails */
  onError?: (error: unknown) => void;
}

/**
 * Resource client for creating, retrieving, listing, and tracking insurance claims.
 */
export class ClaimsResource {
  private readonly http: HttpClient;
  private readonly knownStatuses = new Map<string, ClaimStatus>();
  private readonly activePollers = new Set<() => void>();

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Submits a new insurance claim after performing client-side validation.
   */
  public async create(payload: CreateClaimRequestDto): Promise<ClaimDto> {
    assertValidCreateClaim(payload);

    const claim = await this.http.request<ClaimDto>({
      method: 'POST',
      path: '/api/v1/claims',
      body: payload,
    });

    this.knownStatuses.set(claim.id, claim.status);
    return claim;
  }

  /**
   * Retrieves claim details and current status by claim ID.
   */
  public async get(claimId: string): Promise<ClaimDto> {
    assertValidClaimId(claimId);

    const claim = await this.http.request<ClaimDto>({
      method: 'GET',
      path: `/api/v1/claims/${encodeURIComponent(claimId.trim())}`,
    });

    this.knownStatuses.set(claim.id, claim.status);
    return claim;
  }

  /**
   * Lists claims with optional status filter and pagination parameters.
   */
  public async list(
    query?: ListClaimsQueryDto
  ): Promise<PaginatedResponseDto<ClaimDto>> {
    assertValidListClaimsQuery(query);

    const response = await this.http.request<PaginatedResponseDto<ClaimDto>>({
      method: 'GET',
      path: '/api/v1/claims',
      query: {
        status: query?.status,
        page: query?.page,
        pageSize: query?.pageSize,
      },
    });

    for (const claim of response.data) {
      this.knownStatuses.set(claim.id, claim.status);
    }

    return response;
  }

  /**
   * Subscribes to status changes for a specific claim by polling the API.
   * Invokes `callback(newStatus, claim)` whenever the claim's status transitions.
   *
   * @returns An `unsubscribe` function to stop polling.
   */
  public onStatusChange(
    claimId: string,
    callback: ClaimStatusChangeCallback,
    options?: StatusPollingOptions
  ): () => void {
    assertValidClaimId(claimId);

    if (typeof callback !== 'function') {
      throw new ValidationError('Invalid status change callback', {
        callback: 'must be a function',
      });
    }

    const intervalMs = options?.intervalMs ?? 1000;
    if (typeof intervalMs !== 'number' || intervalMs <= 0) {
      throw new ValidationError('Invalid polling interval', {
        intervalMs: 'must be a positive number',
      });
    }

    const normalizedId = claimId.trim();
    let lastStatus: ClaimStatus | undefined =
      this.knownStatuses.get(normalizedId);
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const scheduleNext = () => {
      if (stopped) {
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, intervalMs);
    };

    const poll = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      try {
        const claim = await this.get(normalizedId);
        if (stopped) {
          return;
        }
        if (lastStatus === undefined) {
          lastStatus = claim.status;
        } else if (claim.status !== lastStatus) {
          lastStatus = claim.status;
          callback(claim.status, claim);
        }
      } catch (err) {
        if (!stopped && options?.onError) {
          options.onError(err);
        }
      } finally {
        scheduleNext();
      }
    };

    const unsubscribe = (): void => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      this.activePollers.delete(unsubscribe);
    };

    this.activePollers.add(unsubscribe);

    // Start first check immediately if we don't have a baseline yet, otherwise schedule
    if (lastStatus === undefined) {
      void poll();
    } else {
      scheduleNext();
    }

    return unsubscribe;
  }

  /**
   * Stops all active `onStatusChange` polling subscriptions.
   */
  public stopAllPolling(): void {
    for (const stop of Array.from(this.activePollers)) {
      stop();
    }
    this.activePollers.clear();
  }
}
