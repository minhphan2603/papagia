/**
 * Target environment for the Insurance SDK.
 */
export type Environment = 'sandbox' | 'production';

/**
 * Supported insurance claim types.
 */
export const CLAIM_TYPES = [
  'OUTPATIENT',
  'INPATIENT',
  'DENTAL',
  'OPTICAL',
  'EMERGENCY',
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

/**
 * Lifecycle statuses of an insurance claim.
 */
export const CLAIM_STATUSES = [
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAID',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Supported ISO 4217 currency codes.
 */
export const CURRENCIES = ['THB', 'USD', 'SGD', 'EUR', 'GBP'] as const;

export type Currency = (typeof CURRENCIES)[number];

/**
 * Supported supporting document types for a claim.
 */
export const DOCUMENT_TYPES = [
  'medical_receipt',
  'medical_certificate',
  'prescription',
  'discharge_summary',
  'id_card',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Standardized API error codes returned by the server.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';
