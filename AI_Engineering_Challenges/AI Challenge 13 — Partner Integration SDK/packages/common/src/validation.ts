import { z } from 'zod';
import {
  CLAIM_STATUSES,
  CLAIM_TYPES,
  CURRENCIES,
  DOCUMENT_TYPES,
} from './types';

/**
 * Regular expression for policy IDs (e.g., POL-123, POL-ABC-001).
 */
export const POLICY_ID_REGEX = /^POL-[A-Z0-9-]+$/i;

/**
 * Regular expression for ICD-10 diagnosis codes (e.g., J06.9, A00, S82.101A).
 */
export const ICD10_CODE_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/i;

/**
 * Regular expression for ISO 8601 calendar dates (YYYY-MM-DD).
 */
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks whether a string is a valid calendar date in YYYY-MM-DD format.
 */
export function isValidIsoDate(dateStr: string): boolean {
  if (!ISO_DATE_REGEX.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Converts a ZodError into a flat field-level error dictionary (`Record<string, string>`),
 * keeping the first validation issue encountered per field.
 */
export function zodErrorToFieldMap(
  error: z.ZodError,
  fallbackKey = '_root'
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : fallbackKey;
    if (fields[key] == null) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

/**
 * Helper to create a required enum schema that reports `'required'` when nullish or empty,
 * and `'must be one of: ...'` for invalid values.
 */
function createRequiredEnumSchema<T extends readonly [string, ...string[]]>(
  values: T
) {
  return z.preprocess(
    (val) =>
      typeof val === 'string' && val.trim() === ''
        ? undefined
        : (val ?? undefined),
    z.enum(values, {
      errorMap: (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.invalid_type && ctx.data == null) {
          return { message: 'required' };
        }
        return { message: `must be one of: ${values.join(', ')}` };
      },
    })
  );
}

/**
 * Zod schema for creating a new insurance claim (`POST /api/v1/claims`).
 */
export const CreateClaimSchema = z.object(
  {
    policyId: z.preprocess(
      (val) => val ?? undefined,
      z
        .string({
          required_error: 'required',
          invalid_type_error: 'must be a string',
        })
        .trim()
        .min(1, 'required')
        .refine((val) => POLICY_ID_REGEX.test(val), {
          message: 'invalid format (expected POL-xxx)',
        })
    ),
    claimType: createRequiredEnumSchema(CLAIM_TYPES),
    diagnosisCode: z.preprocess(
      (val) => val ?? undefined,
      z
        .string({
          required_error: 'required',
          invalid_type_error: 'must be a string',
        })
        .trim()
        .min(1, 'required')
        .refine((val) => ICD10_CODE_REGEX.test(val), {
          message: 'invalid ICD-10 diagnosis code format (e.g. J06.9)',
        })
    ),
    treatmentDate: z.preprocess(
      (val) => val ?? undefined,
      z
        .string({
          required_error: 'required',
          invalid_type_error: 'must be a string in YYYY-MM-DD format',
        })
        .trim()
        .min(1, 'required')
        .refine((val) => isValidIsoDate(val), {
          message: 'invalid date format (expected YYYY-MM-DD)',
        })
        .refine(
          (val) => {
            const todayIso = new Date().toISOString().slice(0, 10);
            return val <= todayIso;
          },
          {
            message: 'treatmentDate cannot be in the future',
          }
        )
    ),
    amount: z.preprocess(
      (val) => val ?? undefined,
      z
        .number({
          required_error: 'required',
          invalid_type_error: 'must be a valid number',
        })
        .finite('must be a valid number')
        .positive('must be positive')
    ),
    currency: createRequiredEnumSchema(CURRENCIES),
    description: z
      .string({ invalid_type_error: 'must be a string' })
      .optional(),
  },
  {
    required_error: 'request body must be a valid object',
    invalid_type_error: 'request body must be a valid object',
  }
);

/**
 * Zod schema for listing claims query parameters (`GET /api/v1/claims`).
 */
export const ListClaimsQuerySchema = z
  .object(
    {
      status: z
        .enum(CLAIM_STATUSES, {
          errorMap: () => ({
            message: `must be one of: ${CLAIM_STATUSES.join(', ')}`,
          }),
        })
        .optional(),
      page: z
        .number({
          invalid_type_error: 'must be an integer greater than or equal to 1',
        })
        .int('must be an integer greater than or equal to 1')
        .min(1, 'must be an integer greater than or equal to 1')
        .optional(),
      pageSize: z
        .number({
          invalid_type_error: 'must be an integer between 1 and 100',
        })
        .int('must be an integer between 1 and 100')
        .min(1, 'must be an integer between 1 and 100')
        .max(100, 'must be an integer between 1 and 100')
        .optional(),
    },
    {
      invalid_type_error: 'query parameters must be an object',
    }
  )
  .nullish();

/**
 * Zod schema for document classification type.
 */
export const DocumentTypeSchema = createRequiredEnumSchema(DOCUMENT_TYPES);

/**
 * Zod schema for non-empty claim IDs.
 */
export const ClaimIdSchema = z.preprocess(
  (val) => val ?? undefined,
  z
    .string({
      required_error: 'required',
      invalid_type_error: 'required',
    })
    .trim()
    .min(1, 'required')
);

/**
 * Zod schema for SDK initialization configuration.
 */
export const SDKConfigSchema = z.object({
  apiKey: z.preprocess(
    (val) => val ?? undefined,
    z
      .string({
        required_error: 'required',
        invalid_type_error: 'required',
      })
      .trim()
      .min(1, 'required')
  ),
  environment: z.enum(['sandbox', 'production'], {
    errorMap: () => ({
      message: 'must be either "sandbox" or "production"',
    }),
  }),
  timeout: z
    .number({
      invalid_type_error: 'must be a positive number of milliseconds',
    })
    .finite('must be a positive number of milliseconds')
    .positive('must be a positive number of milliseconds')
    .optional(),
});

/**
 * Validates a CreateClaimRequestDto payload using Zod and returns a map of field-level errors.
 * Returns an empty object `{}` if all fields are valid.
 */
export function validateCreateClaimPayload(
  payload: unknown
): Record<string, string> {
  const result = CreateClaimSchema.safeParse(payload);
  return result.success ? {} : zodErrorToFieldMap(result.error, '_root');
}

/**
 * Validates query parameters for listing claims using Zod.
 */
export function validateListClaimsQuery(
  query: unknown
): Record<string, string> {
  const result = ListClaimsQuerySchema.safeParse(query);
  return result.success ? {} : zodErrorToFieldMap(result.error, '_query');
}

/**
 * Validates document upload metadata type using Zod.
 */
export function validateDocumentType(type: unknown): Record<string, string> {
  const result = DocumentTypeSchema.safeParse(type);
  if (result.success) {
    return {};
  }
  return { type: result.error.issues[0]?.message ?? 'required' };
}
