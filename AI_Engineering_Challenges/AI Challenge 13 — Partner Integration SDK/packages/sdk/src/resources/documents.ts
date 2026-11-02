import { ClaimDocumentDto } from '@insurtech/common';
import { HttpClient } from '../http-client';
import {
  assertValidClaimId,
  normalizeAndValidateDocumentUpload,
  UploadableFile,
  UploadDocumentOptions,
} from '../validator';

/**
 * Resource client for uploading and listing supporting documents on a claim.
 */
export class DocumentsResource {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Uploads a document for a specific claim with client-side validation and progress reporting.
   */
  public async upload(
    claimId: string,
    file: UploadableFile,
    options: UploadDocumentOptions
  ): Promise<ClaimDocumentDto> {
    const normalized = normalizeAndValidateDocumentUpload(
      claimId,
      file,
      options
    );

    const contentBase64 = normalized.buffer.toString('base64');

    return this.http.request<ClaimDocumentDto>({
      method: 'POST',
      path: `/api/v1/claims/${encodeURIComponent(claimId.trim())}/documents`,
      body: {
        type: normalized.type,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        contentBase64,
      },
      isUpload: true,
      onProgress: options.onProgress,
    });
  }

  /**
   * Lists all uploaded documents associated with a claim.
   */
  public async list(claimId: string): Promise<ClaimDocumentDto[]> {
    assertValidClaimId(claimId);

    return this.http.request<ClaimDocumentDto[]>({
      method: 'GET',
      path: `/api/v1/claims/${encodeURIComponent(claimId.trim())}/documents`,
    });
  }
}
