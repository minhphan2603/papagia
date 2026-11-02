import {
  ApiErrorCode,
  ClaimStatus,
  ClaimType,
  Currency,
  DocumentType,
} from './types';

/**
 * Request body for POST /api/v1/auth/token
 */
export interface AuthTokenRequestDto {
  apiKey: string;
}

/**
 * Response body for POST /api/v1/auth/token
 */
export interface AuthTokenResponseDto {
  accessToken: string;
  tokenType: 'Bearer';
  /** Token lifetime in seconds (e.g., 3600 for 1 hour) */
  expiresIn: number;
  /** ISO 8601 expiration timestamp */
  expiresAt: string;
}

/**
 * Request body for POST /api/v1/claims
 */
export interface CreateClaimRequestDto {
  /** Policy identifier (e.g., 'POL-123') */
  policyId: string;
  /** Category of the insurance claim */
  claimType: ClaimType;
  /** ICD-10 diagnosis code (e.g., 'J06.9') */
  diagnosisCode: string;
  /** Date of medical treatment in YYYY-MM-DD format */
  treatmentDate: string;
  /** Claimed monetary amount (must be positive) */
  amount: number;
  /** Three-letter ISO currency code (e.g., 'THB') */
  currency: Currency;
  /** Optional clinical notes or claim description */
  description?: string;
}

/**
 * Claim resource representation returned by the API.
 */
export interface ClaimDto {
  /** Unique claim identifier (e.g., 'CLM-001') */
  id: string;
  /** Policy identifier (e.g., 'POL-123') */
  policyId: string;
  /** Category of the insurance claim */
  claimType: ClaimType;
  /** Current processing status of the claim */
  status: ClaimStatus;
  /** ICD-10 diagnosis code */
  diagnosisCode: string;
  /** Date of treatment in YYYY-MM-DD format */
  treatmentDate: string;
  /** Claimed monetary amount */
  amount: number;
  /** Currency code */
  currency: Currency;
  /** Optional description */
  description?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/**
 * Query parameters for GET /api/v1/claims
 */
export interface ListClaimsQueryDto {
  /** Optional status filter */
  status?: ClaimStatus;
  /** 1-based page number (default: 1) */
  page?: number;
  /** Number of items per page (default: 20, max: 100) */
  pageSize?: number;
}

/**
 * Pagination metadata included in paginated list responses.
 */
export interface PaginationMetaDto {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Generic paginated list response envelope.
 */
export interface PaginatedResponseDto<T> {
  data: T[];
  pagination: PaginationMetaDto;
}

/**
 * Request body / metadata for POST /api/v1/claims/:id/documents
 */
export interface UploadDocumentRequestDto {
  /** Document classification */
  type: DocumentType;
  /** Original file name */
  fileName: string;
  /** MIME type of the uploaded file */
  mimeType: string;
  /** Base64-encoded file content */
  contentBase64: string;
}

/**
 * Document metadata resource returned by the API.
 */
export interface ClaimDocumentDto {
  /** Unique document identifier (e.g., 'DOC-001') */
  id: string;
  /** Associated claim ID */
  claimId: string;
  /** Document classification */
  type: DocumentType;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** ISO 8601 upload timestamp */
  uploadedAt: string;
}

/**
 * Standardized error payload returned by the Mock API server.
 */
export interface ApiErrorResponseDto {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}
