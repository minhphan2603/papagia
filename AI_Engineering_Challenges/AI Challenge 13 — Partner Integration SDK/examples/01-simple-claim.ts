import { MockApiServer } from '@insurtech/mock-api';
import {
  InsuranceSDK,
  ValidationError,
  AuthError,
  NetworkError,
} from '@insurtech/sdk';

/**
 * Ensures a Mock API server is running on port 3000 (starts one if not already running).
 */
async function ensureMockServer(): Promise<() => Promise<void>> {
  const server = new MockApiServer({
    port: 3000,
    minDelayMs: 200,
    maxDelayMs: 500,
    failureRate: 0.1, // ~10% simulated 503 transient failure rate
  });

  try {
    await server.start();
    console.log(
      '[MockServer] Started embedded Mock API server on http://127.0.0.1:3000\n'
    );
    return () => server.stop();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.log(
        '[MockServer] Using existing Mock API server on http://127.0.0.1:3000\n'
      );
      return async () => {};
    }
    throw err;
  }
}

async function runExample1(): Promise<void> {
  console.log('=== Example 1: Simple Claim Submission ===\n');
  const stopServer = await ensureMockServer();

  try {
    // 1. Initialize the SDK
    const sdk = new InsuranceSDK({
      apiKey: 'pk_test_partner_demo_001',
      environment: 'sandbox',
      timeout: 30000,
    });

    // 2. Create a new outpatient claim
    console.log('1. Submitting a new outpatient claim...');
    const createdClaim = await sdk.claims.create({
      policyId: 'POL-123',
      claimType: 'OUTPATIENT',
      diagnosisCode: 'J06.9',
      treatmentDate: '2024-03-15',
      amount: 15000,
      currency: 'THB',
      description:
        'Outpatient consultation and medication for acute pharyngitis',
    });
    console.log('   Created Claim:', createdClaim);

    // 3. Retrieve claim details by ID
    console.log(`\n2. Fetching claim details for ${createdClaim.id}...`);
    const fetchedClaim = await sdk.claims.get(createdClaim.id);
    console.log(
      `   Claim ${fetchedClaim.id} status: ${fetchedClaim.status} (${fetchedClaim.amount} ${fetchedClaim.currency})`
    );

    // 4. List claims filtered by status = PENDING
    console.log('\n3. Listing PENDING claims (page 1, pageSize 20)...');
    const claimsList = await sdk.claims.list({
      status: 'PENDING',
      page: 1,
      pageSize: 20,
    });
    console.log(
      `   Found ${claimsList.pagination.totalItems} PENDING claim(s):`,
      claimsList.data.map((c) => `${c.id} (${c.policyId})`).join(', ')
    );

    // 5. Demonstrate client-side validation error handling
    console.log('\n4. Testing client-side validation with invalid data...');
    try {
      await sdk.claims.create({
        policyId: '',
        claimType: 'OUTPATIENT',
        diagnosisCode: 'J06.9',
        treatmentDate: '2024-03-15',
        amount: -500,
        currency: 'THB',
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        console.log(
          '   Caught expected ValidationError before API call:',
          error.fields
        );
      } else if (error instanceof AuthError) {
        console.log('   Re-authenticate:', error.message);
      } else if (error instanceof NetworkError) {
        console.log('   Retry later:', error.message);
      }
    }

    console.log('\n✅ Example 1 completed successfully!');
  } finally {
    await stopServer();
  }
}

void runExample1();
