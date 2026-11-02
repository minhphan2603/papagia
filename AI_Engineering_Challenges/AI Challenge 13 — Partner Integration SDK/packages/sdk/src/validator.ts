import {
  ClaimIdSchema,
  CreateClaimRequestDto,
  DocumentType,
  ListClaimsQueryDto,
  SDKConfigSchema,
  validateCreateClaimPayload,
  validateDocumentType,
  validateListClaimsQuery,
  zodErrorToFieldMap,
} from '@insurtech/common';
import { ValidationError } from './errors';

export interface UploadableFileObject {
  data: Buffer | Uint8Array | string;
  fileName?: string;
  mimeType?: string;
}

export type UploadableFile =
  Buffer | Uint8Array | string | UploadableFileObject;

export interface UploadDocumentOptions {
  /** Classification of the document (e.g., 'medical_receipt') */
  type: DocumentType;
  /** Optional file name override */
  fileName?: string;
  /** Optional MIME type override (default: 'application/octet-stream') */
  mimeType?: string;
  /** Optional callback invoked with upload completion percentage (0..100) */
  onProgress?: (percent: number) => void;
}

/**
 * Validates SDK initialization options using `SDKConfigSchema`.
 */
export function validateSDKConfig(config: {
  apiKey?: unknown;
  environment?: unknown;
  timeout?: unknown;
}): void {
  const result = SDKConfigSchema.safeParse(config ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Invalid SDK configuration',
      zodErrorToFieldMap(result.error)
    );
  }
}

/**
 * Validates CreateClaimRequestDto on the client before making any network request.
 */
export function assertValidCreateClaim(input: CreateClaimRequestDto): void {
  const fields = validateCreateClaimPayload(input);
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(
      'Client-side validation failed for claim creation',
      fields
    );
  }
}

/**
 * Validates a claimId parameter on the client before making any network request.
 */
export function assertValidClaimId(claimId: string): void {
  const result = ClaimIdSchema.safeParse(claimId);
  if (!result.success) {
    throw new ValidationError('Invalid claim ID', {
      claimId: result.error.issues[0]?.message ?? 'required',
    });
  }
}

/**
 * Validates ListClaimsQueryDto on the client before making any network request.
 */
export function assertValidListClaimsQuery(query?: ListClaimsQueryDto): void {
  const fields = validateListClaimsQuery(query);
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(
      'Client-side validation failed for claim list filters',
      fields
    );
  }
}

/**
 * Normalizes and validates document upload parameters before making any network request.
 */
export function normalizeAndValidateDocumentUpload(
  claimId: string,
  file: UploadableFile,
  options: UploadDocumentOptions
): {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  type: DocumentType;
} {
  const fields: Record<string, string> = {};

  const claimIdResult = ClaimIdSchema.safeParse(claimId);
  if (!claimIdResult.success) {
    fields.claimId = claimIdResult.error.issues[0]?.message ?? 'required';
  }

  let buffer: Buffer | undefined;
  let inferredFileName: string | undefined;
  let inferredMimeType: string | undefined;

  if (file == null) {
    fields.file = 'required';
  } else if (Buffer.isBuffer(file)) {
    buffer = file;
  } else if (file instanceof Uint8Array) {
    buffer = Buffer.from(file);
  } else if (typeof file === 'string') {
    buffer = Buffer.from(file, 'utf8');
  } else if (typeof file === 'object' && 'data' in file) {
    const rawData = file.data;
    if (Buffer.isBuffer(rawData)) {
      buffer = rawData;
    } else if (rawData instanceof Uint8Array) {
      buffer = Buffer.from(rawData);
    } else if (typeof rawData === 'string') {
      buffer = Buffer.from(rawData, 'utf8');
    } else {
      fields.file = 'invalid file data buffer';
    }
    inferredFileName = file.fileName;
    inferredMimeType = file.mimeType;
  } else {
    fields.file = 'must be a Buffer, Uint8Array, string, or file descriptor';
  }

  if (buffer != null && buffer.byteLength === 0) {
    fields.file = 'file content must not be empty';
  }

  const typeErrors = validateDocumentType(options?.type);
  Object.assign(fields, typeErrors);

  if (options?.onProgress != null && typeof options.onProgress !== 'function') {
    fields.onProgress = 'must be a function';
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(
      'Client-side validation failed for document upload',
      fields
    );
  }

  const resolvedType = options.type;
  const resolvedFileName =
    options.fileName?.trim() ||
    inferredFileName?.trim() ||
    `${resolvedType}.pdf`;
  const resolvedMimeType =
    options.mimeType?.trim() || inferredMimeType?.trim() || 'application/pdf';

  return {
    buffer: buffer!,
    fileName: resolvedFileName,
    mimeType: resolvedMimeType,
    type: resolvedType,
  };
}
