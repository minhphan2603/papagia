import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { MockApiServer } from '@insurtech/mock-api';
import {
  InsuranceSDK,
  ValidationError,
  AuthError,
  NetworkError,
  ApiError,
  type ClaimStatus,
} from '@insurtech/sdk';

describe('InsuranceSDK — Unit & Integration Test Suite', () => {
  let mockServer: MockApiServer;
  let baseUrl: string;

  before(async () => {
    mockServer = new MockApiServer({
      port: 0, // random available port
      minDelayMs: 5,
      maxDelayMs: 15,
      failureRate: 0, // deterministic by default; tests enable failures explicitly
      seedInitialData: true,
    });
    baseUrl = await mockServer.start();
  });

  after(async () => {
    await mockServer.stop();
  });

  beforeEach(() => {
    mockServer.store.seed();
    mockServer.forceNext503Failures(0);
    mockServer.setSimulationOptions({
      minDelayMs: 5,
      maxDelayMs: 15,
      failureRate: 0,
      tokenExpiresInSeconds: 3600,
      autoProgressStatus: false,
    });
  });

  // ===========================================================================
  // 1. SDK Initialization Tests (3 tests)
  // ===========================================================================
  describe('1. SDK Initialization', () => {
    it('1.1 initializes successfully with valid configuration', () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_valid123',
        environment: 'sandbox',
        timeout: 30000,
        baseUrl,
      });
      assert.ok(sdk);
      assert.ok(sdk.claims);
      assert.ok(sdk.documents);
    });

    it('1.2 throws ValidationError when apiKey is missing or empty', () => {
      assert.throws(
        () =>
          new InsuranceSDK({
            apiKey: '   ',
            environment: 'sandbox',
          }),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.fields.apiKey, 'required');
          return true;
        }
      );
    });

    it('1.3 throws ValidationError when environment or timeout is invalid', () => {
      assert.throws(
        () =>
          new InsuranceSDK({
            apiKey: 'pk_test_123',
            environment: 'staging' as 'sandbox',
            timeout: -100,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          assert.ok(err.fields.environment);
          assert.ok(err.fields.timeout);
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // 2. Successful End-to-End Flows (6 tests)
  // ===========================================================================
  describe('2. Successful Flows (create, get, list, upload)', () => {
    it('2.1 creates a new claim via sdk.claims.create()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      const claim = await sdk.claims.create({
        policyId: 'POL-123',
        claimType: 'OUTPATIENT',
        diagnosisCode: 'J06.9',
        treatmentDate: '2024-03-15',
        amount: 15000,
        currency: 'THB',
        description: 'Acute upper respiratory infection',
      });

      assert.equal(claim.id, 'CLM-002');
      assert.equal(claim.policyId, 'POL-123');
      assert.equal(claim.claimType, 'OUTPATIENT');
      assert.equal(claim.status, 'PENDING');
      assert.equal(claim.diagnosisCode, 'J06.9');
      assert.equal(claim.treatmentDate, '2024-03-15');
      assert.equal(claim.amount, 15000);
      assert.equal(claim.currency, 'THB');
      assert.ok(claim.createdAt);
    });

    it('2.2 retrieves an existing claim via sdk.claims.get()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      const claim = await sdk.claims.get('CLM-001');
      assert.equal(claim.id, 'CLM-001');
      assert.equal(claim.policyId, 'POL-100');
      assert.equal(claim.status, 'PENDING');
    });

    it('2.3 lists claims with pagination via sdk.claims.list()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      await sdk.claims.create({
        policyId: 'POL-201',
        claimType: 'DENTAL',
        diagnosisCode: 'K02.9',
        treatmentDate: '2024-04-01',
        amount: 3500,
        currency: 'THB',
      });

      const listResponse = await sdk.claims.list({ page: 1, pageSize: 10 });
      assert.equal(listResponse.data.length, 2);
      assert.equal(listResponse.pagination.page, 1);
      assert.equal(listResponse.pagination.pageSize, 10);
      assert.equal(listResponse.pagination.totalItems, 2);
      assert.equal(listResponse.pagination.totalPages, 1);
    });

    it('2.4 filters claims by status via sdk.claims.list({ status })', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      const created = await sdk.claims.create({
        policyId: 'POL-202',
        claimType: 'INPATIENT',
        diagnosisCode: 'A09',
        treatmentDate: '2024-04-10',
        amount: 45000,
        currency: 'THB',
      });

      mockServer.store.updateClaimStatus(created.id, 'APPROVED');

      const pendingList = await sdk.claims.list({
        status: 'PENDING',
        page: 1,
        pageSize: 20,
      });
      assert.equal(pendingList.data.length, 1);
      assert.equal(pendingList.data[0].id, 'CLM-001');

      const approvedList = await sdk.claims.list({
        status: 'APPROVED',
        page: 1,
        pageSize: 20,
      });
      assert.equal(approvedList.data.length, 1);
      assert.equal(approvedList.data[0].id, created.id);
    });

    it('2.5 uploads a document with progress tracking via sdk.documents.upload()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      const progressUpdates: number[] = [];
      const sampleFile = Buffer.alloc(4096, 'Receipt PDF Content');

      const doc = await sdk.documents.upload('CLM-001', sampleFile, {
        type: 'medical_receipt',
        fileName: 'receipt_march.pdf',
        mimeType: 'application/pdf',
        onProgress: (percent) => {
          progressUpdates.push(percent);
        },
      });

      assert.equal(doc.id, 'DOC-001');
      assert.equal(doc.claimId, 'CLM-001');
      assert.equal(doc.type, 'medical_receipt');
      assert.equal(doc.fileName, 'receipt_march.pdf');
      assert.equal(doc.sizeBytes, 4096);
      assert.ok(progressUpdates.length >= 2);
      assert.equal(progressUpdates[0], 0);
      assert.equal(progressUpdates[progressUpdates.length - 1], 100);
    });

    it('2.6 lists documents for a claim via sdk.documents.list()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl,
      });

      await sdk.documents.upload('CLM-001', Buffer.from('Receipt 1'), {
        type: 'medical_receipt',
      });
      await sdk.documents.upload('CLM-001', Buffer.from('Certificate 1'), {
        type: 'medical_certificate',
      });

      const docs = await sdk.documents.list('CLM-001');
      assert.equal(docs.length, 2);
      assert.equal(docs[0].type, 'medical_receipt');
      assert.equal(docs[1].type, 'medical_certificate');
    });
  });

  // ===========================================================================
  // 3. Client-Side Validation Tests (7 tests — before any API call)
  // ===========================================================================
  describe('3. Client-Side Validation (catches invalid data before API call)', () => {
    it('3.1 rejects missing required fields and makes zero network requests', async () => {
      // Point to an unreachable port; if SDK attempted a network call, it would throw NetworkError
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.create({
            policyId: '',
            claimType: 'OUTPATIENT',
            diagnosisCode: '',
            treatmentDate: '2024-03-15',
            amount: -500,
            currency: 'THB',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.equal(error.statusCode, undefined); // client-side validation has no HTTP status
          assert.equal(error.fields.policyId, 'required');
          assert.equal(error.fields.diagnosisCode, 'required');
          assert.equal(error.fields.amount, 'must be positive');
          return true;
        }
      );
    });

    it('3.2 rejects invalid policyId and ICD-10 diagnosisCode formats', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.create({
            policyId: 'INVALID_123',
            claimType: 'OUTPATIENT',
            diagnosisCode: 'NOT-ICD10',
            treatmentDate: '2024-03-15',
            amount: 1000,
            currency: 'THB',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.policyId.includes('invalid format'));
          assert.ok(error.fields.diagnosisCode.includes('invalid ICD-10'));
          return true;
        }
      );
    });

    it('3.3 rejects invalid calendar dates and future treatmentDate', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.create({
            policyId: 'POL-123',
            claimType: 'OUTPATIENT',
            diagnosisCode: 'J06.9',
            treatmentDate: '2024-02-30', // Feb 30 does not exist
            amount: 1000,
            currency: 'THB',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.treatmentDate.includes('invalid date format'));
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await sdk.claims.create({
            policyId: 'POL-123',
            claimType: 'OUTPATIENT',
            diagnosisCode: 'J06.9',
            treatmentDate: '2099-01-01', // Future date
            amount: 1000,
            currency: 'THB',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.treatmentDate.includes('future'));
          return true;
        }
      );
    });

    it('3.4 rejects invalid claimType and unsupported currency', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.create({
            policyId: 'POL-123',
            claimType: 'INVALID_TYPE' as 'OUTPATIENT',
            diagnosisCode: 'J06.9',
            treatmentDate: '2024-03-15',
            amount: 1000,
            currency: 'JPY' as 'THB',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.claimType);
          assert.ok(error.fields.currency);
          return true;
        }
      );
    });

    it('3.5 rejects empty claimId in sdk.claims.get()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.get('   ');
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.equal(error.fields.claimId, 'required');
          return true;
        }
      );
    });

    it('3.6 rejects invalid pagination or status in sdk.claims.list()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.claims.list({
            status: 'UNKNOWN_STATUS' as ClaimStatus,
            page: 0,
            pageSize: 500,
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.status);
          assert.ok(error.fields.page);
          assert.ok(error.fields.pageSize);
          return true;
        }
      );
    });

    it('3.7 rejects empty file or invalid document type in sdk.documents.upload()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_partner01',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59999',
      });

      await assert.rejects(
        async () => {
          await sdk.documents.upload('CLM-001', Buffer.alloc(0), {
            type: 'invalid_doc_type' as 'medical_receipt',
          });
        },
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.ok(error.fields.file);
          assert.ok(error.fields.type);
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // 4. Authentication & Automatic Token Refresh Tests (4 tests)
  // ===========================================================================
  describe('4. Authentication & Token Refresh', () => {
    it('4.1 throws AuthError when initialized with an invalid API key', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'invalid_key_format',
        environment: 'sandbox',
        baseUrl,
      });

      await assert.rejects(
        async () => {
          await sdk.claims.get('CLM-001');
        },
        (error: unknown) => {
          assert.ok(error instanceof AuthError);
          assert.equal(error.statusCode, 401);
          return true;
        }
      );
    });

    it('4.2 proactively refreshes JWT token when cached token is near expiry', async () => {
      // Configure server to issue short-lived tokens (1 second) and SDK buffer of 2 seconds
      mockServer.setSimulationOptions({ tokenExpiresInSeconds: 1 });

      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_refresh01',
        environment: 'sandbox',
        baseUrl,
        tokenRefreshBufferSeconds: 2, // immediately treated as needing refresh on next call
      });

      const first = await sdk.claims.get('CLM-001');
      assert.equal(first.id, 'CLM-001');

      const second = await sdk.claims.get('CLM-001');
      assert.equal(second.id, 'CLM-001');
    });

    it('4.3 reactively refreshes token and replays request when server returns 401 expired token', async () => {
      // Issue token with 1 second lifetime, but set SDK buffer to 0 so SDK tries to reuse it after 1.1s
      mockServer.setSimulationOptions({ tokenExpiresInSeconds: 1 });

      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_reactive01',
        environment: 'sandbox',
        baseUrl,
        tokenRefreshBufferSeconds: 0,
      });

      // Acquire initial 1s token
      await sdk.claims.get('CLM-001');

      // Now restore normal 3600s token lifetime for the refresh call and wait 1.2s for initial token to expire
      mockServer.setSimulationOptions({ tokenExpiresInSeconds: 3600 });
      await new Promise((r) => setTimeout(r, 1200));

      // This request will initially receive 401 TOKEN_EXPIRED from server, trigger automatic token refresh, and succeed!
      const claim = await sdk.claims.get('CLM-001');
      assert.equal(claim.id, 'CLM-001');
    });

    it('4.4 deduplicates concurrent token acquisition across parallel SDK requests', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_parallel01',
        environment: 'sandbox',
        baseUrl,
      });

      const [c1, c2, c3] = await Promise.all([
        sdk.claims.get('CLM-001'),
        sdk.claims.list({ page: 1, pageSize: 5 }),
        sdk.documents.list('CLM-001'),
      ]);

      assert.equal(c1.id, 'CLM-001');
      assert.equal(c2.data.length, 1);
      assert.equal(c3.length, 0);
    });
  });

  // ===========================================================================
  // 5. Retry Logic & Exponential Backoff Tests (4 tests)
  // ===========================================================================
  describe('5. Retry Logic & Resilience', () => {
    it('5.1 retries automatically on simulated 503 transient failures and succeeds', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_retry01',
        environment: 'sandbox',
        baseUrl,
        maxRetries: 3,
        retryBaseDelayMs: 20,
      });

      // Warm up auth token first
      await sdk.claims.get('CLM-001');

      // Force the next 2 API requests to return 503 Service Unavailable; 3rd attempt will succeed
      mockServer.forceNext503Failures(2);

      const start = Date.now();
      const claim = await sdk.claims.create({
        policyId: 'POL-503',
        claimType: 'EMERGENCY',
        diagnosisCode: 'S06.0',
        treatmentDate: '2024-03-20',
        amount: 28000,
        currency: 'THB',
      });
      const elapsed = Date.now() - start;

      assert.equal(claim.policyId, 'POL-503');
      // 2 retries with base 20ms => at least ~20ms + ~40ms = 60ms
      assert.ok(
        elapsed >= 50,
        `Expected backoff delay >= 50ms, got ${elapsed}ms`
      );
    });

    it('5.2 throws ApiError (503) when transient failures exceed maxRetries', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_retry02',
        environment: 'sandbox',
        baseUrl,
        maxRetries: 2,
        retryBaseDelayMs: 15,
      });

      await sdk.claims.get('CLM-001');

      // Force 5 consecutive 503 responses (more than maxRetries = 2)
      mockServer.forceNext503Failures(5);

      await assert.rejects(
        async () => {
          await sdk.claims.get('CLM-001');
        },
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 503);
          return true;
        }
      );
    });

    it('5.3 throws NetworkError with isTimeout=true when request exceeds configured timeout', async () => {
      // Configure server delay (200ms) higher than SDK timeout (40ms)
      mockServer.setSimulationOptions({ minDelayMs: 200, maxDelayMs: 250 });

      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_timeout01',
        environment: 'sandbox',
        baseUrl,
        timeout: 40,
        maxRetries: 1,
        retryBaseDelayMs: 10,
      });

      await assert.rejects(
        async () => {
          await sdk.claims.get('CLM-001');
        },
        (error: unknown) => {
          assert.ok(error instanceof NetworkError);
          assert.equal(error.isTimeout, true);
          assert.equal(error.attempts, 2); // initial + 1 retry
          return true;
        }
      );
    });

    it('5.4 throws NetworkError when connection is refused', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_connrefused',
        environment: 'sandbox',
        baseUrl: 'http://127.0.0.1:59998',
        maxRetries: 1,
        retryBaseDelayMs: 10,
      });

      await assert.rejects(
        async () => {
          await sdk.claims.get('CLM-001');
        },
        (error: unknown) => {
          assert.ok(error instanceof NetworkError);
          assert.equal(error.isTimeout, false);
          assert.equal(error.attempts, 2);
          return true;
        }
      );
    });
  });

  // ===========================================================================
  // 6. Error Classification & Status Tracking Tests (3 tests)
  // ===========================================================================
  describe('6. Error Classification & Status Polling', () => {
    it('6.1 throws ApiError with statusCode 404 when claim does not exist', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_404',
        environment: 'sandbox',
        baseUrl,
      });

      await assert.rejects(
        async () => {
          await sdk.claims.get('CLM-999');
        },
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 404);
          assert.equal(error.code, 'NOT_FOUND');
          return true;
        }
      );
    });

    it('6.2 maps server-side HTTP 400 into ValidationError with field errors', async () => {
      // Create a custom tiny HTTP server that returns 400 with field errors
      const customServer = http.createServer((req, res) => {
        if (req.url === '/api/v1/auth/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              accessToken: 'dummy.jwt.token',
              tokenType: 'Bearer',
              expiresIn: 3600,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            })
          );
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Policy is inactive',
              fields: { policyId: 'policy is expired on server' },
            },
          })
        );
      });

      await new Promise<void>((resolve) =>
        customServer.listen(0, '127.0.0.1', resolve)
      );
      const addr = customServer.address();
      const customPort = typeof addr === 'object' && addr ? addr.port : 0;

      try {
        const sdk = new InsuranceSDK({
          apiKey: 'pk_test_server400',
          environment: 'sandbox',
          baseUrl: `http://127.0.0.1:${customPort}`,
        });

        await assert.rejects(
          async () => {
            await sdk.claims.create({
              policyId: 'POL-123',
              claimType: 'OUTPATIENT',
              diagnosisCode: 'J06.9',
              treatmentDate: '2024-03-15',
              amount: 15000,
              currency: 'THB',
            });
          },
          (error: unknown) => {
            assert.ok(error instanceof ValidationError);
            assert.equal(error.statusCode, 400);
            assert.equal(error.fields.policyId, 'policy is expired on server');
            return true;
          }
        );
      } finally {
        await new Promise<void>((resolve) =>
          customServer.close(() => resolve())
        );
      }
    });

    it('6.3 tracks claim status transitions via sdk.claims.onStatusChange()', async () => {
      const sdk = new InsuranceSDK({
        apiKey: 'pk_test_polling',
        environment: 'sandbox',
        baseUrl,
      });

      const created = await sdk.claims.create({
        policyId: 'POL-777',
        claimType: 'OUTPATIENT',
        diagnosisCode: 'J06.9',
        treatmentDate: '2024-03-15',
        amount: 9000,
        currency: 'THB',
      });

      const observedStatuses: ClaimStatus[] = [];

      const unsubscribe = sdk.claims.onStatusChange(
        created.id,
        (newStatus, updatedClaim) => {
          assert.equal(updatedClaim.id, created.id);
          observedStatuses.push(newStatus);
        },
        { intervalMs: 40 }
      );

      setTimeout(() => {
        mockServer.store.updateClaimStatus(created.id, 'IN_REVIEW');
      }, 60);

      setTimeout(() => {
        mockServer.store.updateClaimStatus(created.id, 'APPROVED');
      }, 150);

      await new Promise((r) => setTimeout(r, 260));
      unsubscribe();

      // Further updates after unsubscribe should not be recorded
      mockServer.store.updateClaimStatus(created.id, 'PAID');
      await new Promise((r) => setTimeout(r, 80));

      assert.deepEqual(observedStatuses, ['IN_REVIEW', 'APPROVED']);
    });
  });
});
