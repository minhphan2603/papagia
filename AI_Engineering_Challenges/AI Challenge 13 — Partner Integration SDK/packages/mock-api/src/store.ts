import {
  ClaimDocumentDto,
  ClaimDto,
  ClaimStatus,
  CreateClaimRequestDto,
  DocumentType,
  PaginatedResponseDto,
} from '@insurtech/common';

/**
 * In-memory storage for Claims and Documents.
 */
export class InMemoryStore {
  private claims = new Map<string, ClaimDto>();
  private documents = new Map<string, ClaimDocumentDto[]>();
  private claimSequence = 0;
  private documentSequence = 0;

  constructor(seedInitialData = true) {
    if (seedInitialData) {
      this.seed();
    }
  }

  /**
   * Seeds an initial claim (CLM-001) so `sdk.claims.get('CLM-001')` works out of the box.
   */
  public seed(): void {
    this.claims.clear();
    this.documents.clear();
    this.claimSequence = 1;
    this.documentSequence = 0;

    const now = new Date().toISOString();
    const initialClaim: ClaimDto = {
      id: 'CLM-001',
      policyId: 'POL-100',
      claimType: 'OUTPATIENT',
      status: 'PENDING',
      diagnosisCode: 'J06.9',
      treatmentDate: '2024-03-10',
      amount: 12500,
      currency: 'THB',
      description: 'Initial seeded outpatient claim',
      createdAt: now,
      updatedAt: now,
    };

    this.claims.set(initialClaim.id, initialClaim);
    this.documents.set(initialClaim.id, []);
  }

  public createClaim(input: CreateClaimRequestDto): ClaimDto {
    this.claimSequence += 1;
    const id = `CLM-${String(this.claimSequence).padStart(3, '0')}`;
    const now = new Date().toISOString();

    const claim: ClaimDto = {
      id,
      policyId: input.policyId.trim(),
      claimType: input.claimType,
      status: 'PENDING',
      diagnosisCode: input.diagnosisCode.trim().toUpperCase(),
      treatmentDate: input.treatmentDate,
      amount: input.amount,
      currency: input.currency,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.claims.set(id, claim);
    this.documents.set(id, []);
    return { ...claim };
  }

  public getClaim(id: string): ClaimDto | undefined {
    const claim = this.claims.get(id);
    return claim ? { ...claim } : undefined;
  }

  public updateClaimStatus(
    id: string,
    status: ClaimStatus
  ): ClaimDto | undefined {
    const claim = this.claims.get(id);
    if (!claim) {
      return undefined;
    }
    claim.status = status;
    claim.updatedAt = new Date().toISOString();
    this.claims.set(id, claim);
    return { ...claim };
  }

  public listClaims(options: {
    status?: ClaimStatus;
    page?: number;
    pageSize?: number;
  }): PaginatedResponseDto<ClaimDto> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;

    let allClaims = Array.from(this.claims.values());
    if (options.status) {
      allClaims = allClaims.filter((c) => c.status === options.status);
    }

    const totalItems = allClaims.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const startIndex = (page - 1) * pageSize;
    const data = allClaims
      .slice(startIndex, startIndex + pageSize)
      .map((c) => ({ ...c }));

    return {
      data,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  public addDocument(
    claimId: string,
    docInput: {
      type: DocumentType;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }
  ): ClaimDocumentDto | undefined {
    if (!this.claims.has(claimId)) {
      return undefined;
    }

    this.documentSequence += 1;
    const docId = `DOC-${String(this.documentSequence).padStart(3, '0')}`;
    const doc: ClaimDocumentDto = {
      id: docId,
      claimId,
      type: docInput.type,
      fileName: docInput.fileName,
      mimeType: docInput.mimeType,
      sizeBytes: docInput.sizeBytes,
      uploadedAt: new Date().toISOString(),
    };

    const existing = this.documents.get(claimId) ?? [];
    existing.push(doc);
    this.documents.set(claimId, existing);
    return { ...doc };
  }

  public listDocuments(claimId: string): ClaimDocumentDto[] | undefined {
    if (!this.claims.has(claimId)) {
      return undefined;
    }
    const docs = this.documents.get(claimId) ?? [];
    return docs.map((d) => ({ ...d }));
  }
}
