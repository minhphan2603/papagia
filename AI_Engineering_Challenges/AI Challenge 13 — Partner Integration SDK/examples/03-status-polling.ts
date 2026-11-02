import { MockApiServer } from '@insurtech/mock-api';
import { type ClaimStatus, InsuranceSDK } from '@insurtech/sdk';

async function ensureMockServerWithProgression(): Promise<{
  stop: () => Promise<void>;
  server?: MockApiServer;
}> {
  const server = new MockApiServer({
    port: 3000,
    minDelayMs: 200,
    maxDelayMs: 400,
    failureRate: 0.1,
    autoProgressStatus: true,
    autoProgressIntervalMs: 1800,
  });

  try {
    await server.start();
    console.log(
      '[MockServer] Started embedded Mock API server on http://127.0.0.1:3000\n'
    );
    return { stop: () => server.stop(), server };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.log(
        '[MockServer] Using existing Mock API server on http://127.0.0.1:3000\n'
      );
      return { stop: async () => {} };
    }
    throw err;
  }
}

async function runExample3(): Promise<void> {
  console.log('=== Example 3: Polling for Claim Status Updates ===\n');
  const { stop: stopServer } = await ensureMockServerWithProgression();

  const sdk = new InsuranceSDK({
    apiKey: 'pk_test_partner_demo_003',
    environment: 'sandbox',
    timeout: 30000,
  });

  try {
    // 1. Create a new claim (starts in PENDING status)
    console.log('1. Creating claim to monitor status transitions...');
    const claim = await sdk.claims.create({
      policyId: 'POL-789',
      claimType: 'OUTPATIENT',
      diagnosisCode: 'J06.9',
      treatmentDate: '2024-03-15',
      amount: 15000,
      currency: 'THB',
    });
    console.log(
      `   Claim ${claim.id} created with initial status: ${claim.status}\n`
    );

    // 2. Subscribe to status changes via sdk.claims.onStatusChange
    console.log(`2. Subscribing to status updates for ${claim.id}...`);

    await new Promise<void>((resolve) => {
      const unsubscribe = sdk.claims.onStatusChange(
        claim.id,
        (newStatus: ClaimStatus, updatedClaim) => {
          console.log(
            `   🔔 Claim ${claim.id} is now ${newStatus} (updatedAt: ${updatedClaim.updatedAt})`
          );

          if (
            newStatus === 'APPROVED' ||
            newStatus === 'REJECTED' ||
            newStatus === 'PAID'
          ) {
            console.log(
              `\n3. Final terminal status '${newStatus}' reached. Unsubscribing poller...`
            );
            unsubscribe();
            resolve();
          }
        },
        { intervalMs: 700 }
      );
    });

    console.log('\n✅ Example 3 completed successfully!');
  } finally {
    sdk.destroy();
    await stopServer();
  }
}

void runExample3();
