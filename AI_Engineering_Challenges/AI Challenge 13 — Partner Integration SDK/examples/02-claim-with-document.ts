import { MockApiServer } from '@insurtech/mock-api';
import { InsuranceSDK } from '@insurtech/sdk';

async function ensureMockServer(): Promise<() => Promise<void>> {
  const server = new MockApiServer({
    port: 3000,
    minDelayMs: 200,
    maxDelayMs: 500,
    failureRate: 0.1,
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

async function runExample2(): Promise<void> {
  console.log('=== Example 2: Claim Submission with Document Upload ===\n');
  const stopServer = await ensureMockServer();

  try {
    const sdk = new InsuranceSDK({
      apiKey: 'pk_test_partner_demo_002',
      environment: 'sandbox',
      timeout: 30000,
    });

    // 1. Create a claim first
    console.log('1. Creating claim for inpatient treatment...');
    const claim = await sdk.claims.create({
      policyId: 'POL-456',
      claimType: 'INPATIENT',
      diagnosisCode: 'K35.80',
      treatmentDate: '2024-05-20',
      amount: 85000,
      currency: 'THB',
      description: 'Laparoscopic appendectomy hospitalization',
    });
    console.log(`   Created claim ${claim.id} (status: ${claim.status})\n`);

    // 2. Upload a medical receipt with progress tracking
    console.log(`2. Uploading medical_receipt for claim ${claim.id}...`);
    const sampleReceiptBuffer = Buffer.alloc(
      16 * 1024,
      '%PDF-1.7 Mock Receipt Data '
    );

    const receiptDoc = await sdk.documents.upload(
      claim.id,
      sampleReceiptBuffer,
      {
        type: 'medical_receipt',
        fileName: 'hospital_invoice_may2024.pdf',
        mimeType: 'application/pdf',
        onProgress: (percent) => {
          console.log(`   [Upload Progress] ${percent}% uploaded`);
        },
      }
    );
    console.log('   Uploaded Document:', receiptDoc);

    // 3. Upload a discharge summary document
    console.log(`\n3. Uploading discharge_summary for claim ${claim.id}...`);
    const sampleSummaryBuffer = Buffer.alloc(
      8 * 1024,
      '%PDF-1.7 Discharge Summary '
    );

    await sdk.documents.upload(claim.id, sampleSummaryBuffer, {
      type: 'discharge_summary',
      fileName: 'discharge_summary.pdf',
      mimeType: 'application/pdf',
      onProgress: (percent) => {
        console.log(`   [Upload Progress] ${percent}% uploaded`);
      },
    });

    // 4. List all documents attached to the claim
    console.log(`\n4. Listing all documents for claim ${claim.id}...`);
    const documents = await sdk.documents.list(claim.id);
    console.log(
      `   Total attached documents (${documents.length}):`,
      documents.map(
        (d) => `${d.id}: ${d.fileName} (${d.type}, ${d.sizeBytes} bytes)`
      )
    );

    console.log('\n✅ Example 2 completed successfully!');
  } finally {
    await stopServer();
  }
}

void runExample2();
