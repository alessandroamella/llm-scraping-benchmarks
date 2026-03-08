import { z } from 'zod';
import { regionsArr } from '@/shared/constants/regions';

const openAiLocationCodesDesc =
  '⚠️ REQUIRED: This field MUST always be present. ' +
  `If locationType is REGION: array of region codes (ISTAT 2-digit strings: ${regionsArr.map(([code, name]) => `${code}: ${name}`).join('\n')}). ` +
  'If locationType is PROVINCE: array of province codes (2-letter strings). ' +
  'If locationType is NATIONAL: MUST be null (not omitted, explicitly null).';

// Simplified datetime - using ISO 8601 format which OpenAI supports natively
const dateTimeSchema = z
  .string()
  .describe('Date and time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss)');

const timeRangeSchema = z
  .string()
  .describe('Time range in format HH:mm-HH:mm (e.g., "06:00-09:00").');

// For OpenAI: No discriminated unions at root level, no optional fields (only union with null)
export const BenchmarkAiOpenAISchema = z.object({
  isStrike: z.boolean(),
  strikeData: z
    .union([
      z
        .object({
          startDate: z
            .union([dateTimeSchema, z.null()])
            .describe('Strike start date and time. Use null if not specified.'),
          endDate: z
            .union([dateTimeSchema, z.null()])
            .describe('Strike end date and time. Use null if not specified.'),
          locationType: z
            .union([z.string(), z.null()])
            .describe(
              'Scope: "NATIONAL", "REGION", or "PROVINCE". If uncertain, best guess.',
            ),
          locationCodes: z
            .union([z.array(z.string()), z.null()])
            .describe(openAiLocationCodesDesc),
          guaranteedTimes: z
            .union([z.array(timeRangeSchema), z.null()])
            .describe(
              'Time ranges with guaranteed service. Use null if not specified. Format: HH:mm-HH:mm',
            ),
        })
        .describe(
          '⚠️ ALL FIELDS IN THIS OBJECT ARE REQUIRED. Use null for missing values, never omit fields. Strike data is only present if isStrike is true.',
        ),
      z.null(),
    ])
    .describe(
      'Strike details object when isStrike is true, or null when isStrike is false',
    ),
});

export type BenchmarkAiOpenAI = z.infer<typeof BenchmarkAiOpenAISchema>;

// --- LENIENT SCHEMA FOR OPENAI ---
// Uses unions with null instead of optional fields, matching OpenAI preferences

const openAiLenientLocationCodesDesc = `Location code (province 2-letter code (e.g. RM for Rome, MI for Milano) or region 2-digit code (e.g. ${regionsArr
  .map(([code, name]) => `${code} for ${name}`)
  .join(', ')}))`;

export const BenchmarkAiOpenAILenientStrikeDataSchema = z.object({
  startDate: z
    .union([z.string(), z.null()])
    .describe(
      'Date and time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss). Use null if not specified.',
    ),
  endDate: z
    .union([z.string(), z.null()])
    .describe(
      'Date and time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss). Use null if not specified.',
    ),
  locationType: z
    .union([z.string(), z.null()])
    .describe(
      'Scope of the strike: either PROVINCE, REGION or NATIONAL. Use null if not specified.',
    ),
  locationCodes: z
    .union([
      z.array(z.string().describe(openAiLenientLocationCodesDesc)),
      z.null(),
    ])
    .describe(
      'Array of location codes. Should be null if locationType is NATIONAL or not specified.',
    ),
  guaranteedTimes: z
    .union([
      z.array(z.string().describe('Time range in format HH:mm-HH:mm')),
      z.null(),
    ])
    .describe(
      'Time ranges with guaranteed service. Use null if not specified.',
    ),
});

export const BenchmarkAiOpenAILenientSchema = z.object({
  isStrike: z.boolean(),
  strikeData: z
    .union([BenchmarkAiOpenAILenientStrikeDataSchema, z.null()])
    .describe(
      'Strike details object when isStrike is true, or null when isStrike is false',
    ),
});

export type BenchmarkAiOpenAILenientStrikeData = z.infer<
  typeof BenchmarkAiOpenAILenientStrikeDataSchema
>;
export type BenchmarkAiOpenAILenient = z.infer<
  typeof BenchmarkAiOpenAILenientSchema
>;
