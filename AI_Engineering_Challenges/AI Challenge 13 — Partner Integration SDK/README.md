# Insurtech Partner Integration SDK (`@insurtech/sdk`)

A production-ready TypeScript SDK monorepo that enables insurance partners to embed claim submission, document upload, and real-time claim status tracking into their applications while abstracting authentication, client-side validation, and network resilience.

---

## Monorepo Structure (Yarn Workspaces)

```text
.
├── packages/
│   ├── common/      # @insurtech/common   — Shared DTOs, domain types & validation rules
│   ├── mock-api/    # @insurtech/mock-api — Stateful HTTP Mock API server (JWT, 200-500ms latency, ~10% 503)
│   └── sdk/         # @insurtech/sdk      — Partner TypeScript SDK + 26 unit/integration tests
└── examples/
    ├── 01-simple-claim.ts         # Example 1: Simple claim submission, retrieval, filtering & error handling
    ├── 02-claim-with-document.ts  # Example 2: Claim submission with document upload & progress callback
    └── 03-status-polling.ts       # Example 3: Real-time status polling via sdk.claims.onStatusChange()
```

---

## Quickstart

### 1. Install & Build

```bash
yarn install
yarn build
```

### 2. Authenticate & Create Your First Claim

```typescript
import {
  InsuranceSDK,
  ValidationError,
  AuthError,
  NetworkError,
} from '@insurtech/sdk';

// 1. Initialize the SDK (automatically manages JWT exchange & refresh)
const sdk = new InsuranceSDK({
  apiKey: 'pk_test_xxx',
  environment: 'sandbox', // 'sandbox' or 'production'
  timeout: 30000, // optional, default 30s
});

async function submitFirstClaim() {
  try {
    // 2. Create a claim (validated client-side before making an API call)
    const claim = await sdk.claims.create({
      policyId: 'POL-123',
      claimType: 'OUTPATIENT',
      diagnosisCode: 'J06.9',
      treatmentDate: '2024-03-15',
      amount: 15000,
      currency: 'THB',
    });

    console.log('Created claim:', claim.id, claim.status);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Field errors:', error.fields);
    } else if (error instanceof AuthError) {
      console.error('Authentication failed:', error.message);
    } else if (error instanceof NetworkError) {
      console.error('Network issue, retry later:', error.message);
    }
  }
}

submitFirstClaim();
```

---

## Running Examples & Tests

### Code Quality, Linting & Formatting (ESLint, Prettier, Husky)

```bash
# Run ESLint across all packages, tests, and examples
yarn lint

# Automatically fix ESLint issues
yarn lint:fix

# Format all TypeScript, JSON, and Markdown files with Prettier
yarn format

# Check formatting without modifying files
yarn format:check

# Run full TypeScript typechecking across the entire monorepo
yarn typecheck

# Run all quality checks (format:check + lint + typecheck + test)
yarn check
```

> **Git Hooks (Husky + lint-staged)**: Pre-commit hook in `.husky/pre-commit` automatically runs `lint-staged` (`eslint --fix` and `prettier --write`) and `yarn typecheck` before every commit.

### Run the 26 Unit & Integration Tests

```bash
yarn test
```

### Run the 3 End-to-End Integration Examples

Each example automatically connects to `http://127.0.0.1:3000` if the Mock API server is already running, or starts an embedded Mock API server if port `3000` is free:

```bash
# Run Example 1: Simple claim submission
yarn example:1

# Run Example 2: Claim submission with document upload & progress tracking
yarn example:2

# Run Example 3: Polling for claim status updates (PENDING -> IN_REVIEW -> APPROVED)
yarn example:3

# Or run all 3 examples sequentially:
yarn examples
```

You can also run the standalone Mock API Server in a dedicated terminal:

```bash
yarn start:mock
```

---

## SDK Features

- **Pre-Flight Client-Side Validation**: Validates required fields, positive amounts, policy ID format (`POL-xxx`), ICD-10 diagnosis codes (e.g., `J06.9`), and ISO calendar dates (`YYYY-MM-DD`) _before_ any HTTP call is made.
- **Automatic JWT Lifecycle Management**: Lazily exchanges `apiKey` for a 1-hour JWT token via `POST /api/v1/auth/token`, caches it in memory, proactively refreshes before expiration, deduplicates concurrent refresh requests, and reactively refreshes if a `401` response occurs.
- **Automatic Retry with Exponential Backoff**: Transparently retries `503 Service Unavailable` responses and transient network/timeout errors using exponential backoff with jitter ($\text{delay} = \text{baseDelay} \times 2^{\text{attempt}} + \text{jitter}$).
- **Upload Progress Tracking**: Streams document upload payloads in chunks and reports progress (`0%` to `100%`) via `onProgress`.
- **Typed Error Hierarchy**: Every error is a strongly typed subclass of `InsuranceSDKError` (`ValidationError`, `AuthError`, `NetworkError`, `ApiError`).
- **Strict TypeScript Types**: Zero `any` types across all packages, providing complete IDE autocompletion for DTOs, enums, and options.

---

## API Reference

### `new InsuranceSDK(config: InsuranceSDKConfig)`

Initializes a new SDK client instance.

| Option             | Type                        | Required | Default                           | Description                                       |
| ------------------ | --------------------------- | -------- | --------------------------------- | ------------------------------------------------- |
| `apiKey`           | `string`                    | Yes      | —                                 | Partner API key (`pk_test_...` or `pk_live_...`)  |
| `environment`      | `'sandbox' \| 'production'` | Yes      | —                                 | Target API environment                            |
| `timeout`          | `number`                    | No       | `30000`                           | Request timeout in milliseconds                   |
| `baseUrl`          | `string`                    | No       | `http://127.0.0.1:3000` (sandbox) | Custom base URL override                          |
| `maxRetries`       | `number`                    | No       | `3`                               | Maximum retry attempts on `503` or network errors |
| `retryBaseDelayMs` | `number`                    | No       | `250`                             | Initial exponential backoff delay in milliseconds |

---

### Claims Resource (`sdk.claims`)

#### `sdk.claims.create(payload: CreateClaimRequestDto): Promise<ClaimDto>`

Validates the claim payload client-side and submits a new claim via `POST /api/v1/claims`.

```typescript
const claim = await sdk.claims.create({
  policyId: 'POL-123', // Required, format: POL-xxx
  claimType: 'OUTPATIENT', // 'OUTPATIENT' | 'INPATIENT' | 'DENTAL' | 'OPTICAL' | 'EMERGENCY'
  diagnosisCode: 'J06.9', // Required, valid ICD-10 code
  treatmentDate: '2024-03-15', // Required, YYYY-MM-DD (not in the future)
  amount: 15000, // Required, positive number
  currency: 'THB', // 'THB' | 'USD' | 'SGD' | 'EUR' | 'GBP'
  description: 'Optional notes',
});
```

#### `sdk.claims.get(claimId: string): Promise<ClaimDto>`

Retrieves claim details and current status by ID via `GET /api/v1/claims/:id`.

```typescript
const claim = await sdk.claims.get('CLM-001');
```

#### `sdk.claims.list(query?: ListClaimsQueryDto): Promise<PaginatedResponseDto<ClaimDto>>`

Lists claims with optional status filtering and pagination via `GET /api/v1/claims`.

```typescript
const response = await sdk.claims.list({
  status: 'PENDING', // 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAID'
  page: 1, // 1-based page index (default: 1)
  pageSize: 20, // Items per page, 1..100 (default: 20)
});
console.log(response.data, response.pagination);
```

#### `sdk.claims.onStatusChange(claimId, callback, options?): () => void`

Polls a claim for status changes and invokes `callback(newStatus, claim)` whenever the claim transitions to a new status. Returns an `unsubscribe()` function to stop polling.

```typescript
const unsubscribe = sdk.claims.onStatusChange(
  'CLM-001',
  (newStatus, claim) => {
    console.log(`Claim ${claim.id} is now ${newStatus}`);
  },
  { intervalMs: 1000 }
);

// Stop polling when no longer needed:
unsubscribe();
```

---

### Documents Resource (`sdk.documents`)

#### `sdk.documents.upload(claimId, file, options): Promise<ClaimDocumentDto>`

Uploads a supporting document (`Buffer`, `Uint8Array`, `string`, or `{ data, fileName?, mimeType? }`) for a claim via `POST /api/v1/claims/:id/documents`.

```typescript
const doc = await sdk.documents.upload(claimId, fileBuffer, {
  type: 'medical_receipt', // 'medical_receipt' | 'medical_certificate' | 'prescription' | 'discharge_summary' | 'id_card' | 'other'
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  onProgress: (percent) => console.log(`${percent}% uploaded`),
});
```

#### `sdk.documents.list(claimId: string): Promise<ClaimDocumentDto[]>`

Lists all documents uploaded for a claim via `GET /api/v1/claims/:id/documents`.

```typescript
const docs = await sdk.documents.list('CLM-001');
```

---

### Error Handling

All SDK errors inherit from `InsuranceSDKError`:

| Error Class       | When Thrown                                                                  | Key Properties                                                   |
| ----------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ValidationError` | Client-side validation failure (before API call) or server `400 Bad Request` | `fields: Record<string, string>`, `statusCode?: number`          |
| `AuthError`       | Invalid API key or unrecoverable `401`/`403` authentication error            | `statusCode: number`, `code: 'AUTH_ERROR'`                       |
| `NetworkError`    | Request timeout (`isTimeout: true`) or connection error after retries        | `isTimeout: boolean`, `attempts: number`, `causeError?: unknown` |
| `ApiError`        | Non-2xx server errors (`404 Not Found`, `500`, or exhausted `503` retries)   | `statusCode: number`, `code: string`, `details?: unknown`        |

---

## Mock API Server Endpoints (`@insurtech/mock-api`)

| Method | Path                           | Description                                                                 |
| ------ | ------------------------------ | --------------------------------------------------------------------------- |
| `POST` | `/api/v1/auth/token`           | Exchange API key for a 1-hour HS256 JWT                                     |
| `POST` | `/api/v1/claims`               | Create a new claim (validates fields, returns `400` with `fields` on error) |
| `GET`  | `/api/v1/claims/:id`           | Get claim details and status                                                |
| `GET`  | `/api/v1/claims`               | List claims (paginated, filterable by `status`)                             |
| `POST` | `/api/v1/claims/:id/documents` | Upload a document for a claim                                               |
| `GET`  | `/api/v1/claims/:id/documents` | List documents for a claim                                                  |
