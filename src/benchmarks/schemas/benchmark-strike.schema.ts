import { z } from 'zod';
import { locationCodes } from '@/shared/constants/location-codes';
import { isRegionCode, regionsArr } from '@/shared/constants/regions';
import { LocationType } from '@/shared/enums';

const dateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, {
    message: 'Date must be in format yyyy-MM-dd HH:mm:ss',
  })
  .describe('Date and time in format yyyy-MM-dd HH:mm:ss');

export const timeRangeRegex =
  /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]-(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;

const timeRangeSchema = z.string().regex(timeRangeRegex, {
  message: 'Time range must be in format HH:mm-HH:mm',
});

export const locationCodesDesc =
  'If locationType is REGIONAL, you MUST return an array of 2-digit ISTAT region codes.\n' +
  'If locationType is NATIONAL, locationCodes MUST BE OMITTED completely.\n' +
  `Available Regions:\n${regionsArr.map(([code, name]) => `${code}: ${name}`).join('\n')}`;

// STRICT SCHEMA
export const StrikeDataSchema = z
  .object({
    startDate: dateTimeSchema,
    endDate: dateTimeSchema,
    locationType: z
      .enum(['NATIONAL', 'REGIONAL'])
      .describe('Scope of the strike'),
    locationCodes: z
      .array(z.enum(locationCodes))
      .optional()
      .describe(locationCodesDesc),
    guaranteedTimes: z
      .array(timeRangeSchema)
      .describe(
        'Time ranges during which service is guaranteed (e.g., "06:00-09:00")',
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.locationType !== 'NATIONAL' && !data.locationCodes?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'locationCodes is required when locationType is not NATIONAL',
        path: ['locationCodes'],
      });
    } else if (data.locationType === 'NATIONAL' && data.locationCodes?.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'locationCodes must be omitted when locationType is NATIONAL',
      });
    }
  });

export const BenchmarkStrikeSchema = z.discriminatedUnion('isStrike', [
  z.object({
    isStrike: z.literal(false),
  }),
  z.object({
    isStrike: z.literal(true),
    strikeData: StrikeDataSchema,
  }),
]);

export type BenchmarkStrike = z.infer<typeof BenchmarkStrikeSchema>;
export type StrikeData = z.infer<typeof StrikeDataSchema>;

const formatter = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
});

// Lenient schema
export const LenientStrikeDataSchema = z.object({
  startDate: z
    .string()
    .describe(
      'Date and time in format yyyy-MM-dd HH:mm:ss. Use 24-hour format. Example: 2024-12-31 00:00:00',
    ),
  endDate: z
    .string()
    .describe(
      'Date and time in format yyyy-MM-dd HH:mm:ss. Use 24-hour format. Example: 2024-12-31 00:00:00',
    ),
  locationType: z
    .string()
    .describe('Scope of the strike: either REGIONAL or NATIONAL'),
  locationCodes: z
    .array(
      z
        .string()
        .describe(
          `Location code (region 2-digit code (${formatter.format(
            regionsArr.map(([code, name]) => `${code} for ${name}`),
          )})`,
        ),
    )
    .optional()
    .nullable()
    .describe(
      'Array of location codes. Should be null if locationType is NATIONAL.',
    ),
  guaranteedTimes: z
    .array(z.string().describe('Time range in format HH:mm-HH:mm'))
    .optional()
    .describe(
      'Array of time ranges during which service is guaranteed (e.g., "06:00-09:00"). Optional, can be omitted if not specified.',
    )
    .nullable(),
});

export const BenchmarkLenientSchema = z
  .object({
    isStrike: z
      .boolean()
      .describe(
        'True if this document announces an upcoming strike. False if it is a cancellation, participation info, or real-time update.',
      ),
    strikeData: LenientStrikeDataSchema.optional()
      .nullable()
      .describe('Strike details. Omit or set to null if isStrike is false.'),
  })
  .describe(
    'First, you need to decide if this is a strike or not. If it is not a strike, return { isStrike: false } and omit the strikeData field.\n' +
      'If it is a strike, return { isStrike: true, strikeData: { ... } } where strikeData contains the details of the strike.',
  );

export type LenientStrikeData = z.infer<typeof LenientStrikeDataSchema>;
export type BenchmarkLenientStrike = z.infer<typeof BenchmarkLenientSchema>;

// Define a Union for use in Adapters
export type RawAiResponse = BenchmarkStrike | BenchmarkLenientStrike;

// TRANSFORMATION LOGIC

export function transformToValidStrikeData(
  lenient: LenientStrikeData,
): StrikeData {
  // Fix dates
  const startDate = normalizeDateString(lenient.startDate);
  const endDate = normalizeDateString(lenient.endDate);

  // Normalize locationType
  if (!lenient.locationType) {
    throw new Error('locationType is required');
  }
  let locationType: LocationType = lenient.locationType
    .toUpperCase()
    ?.trim() as LocationType;
  if (['REGION', 'PROVINC'].some((e) => locationType.includes(e)))
    locationType = LocationType.REGIONAL;
  else if (['NATION', 'GENERA', 'NAZION'].some((e) => locationType.includes(e)))
    locationType = LocationType.NATIONAL;
  else if (!Object.values(LocationType).includes(locationType)) {
    // throw new Error(`Invalid locationType: ${lenient.locationType}`);

    console.warn(
      `⚠️ Unexpected locationType: ${lenient.locationType}, defaulting to REGIONAL`,
    );
    locationType = LocationType.REGIONAL;
  }

  // Transform locationCodes
  let locationCodes: string[] | undefined;
  if (locationType === 'NATIONAL') {
    locationCodes = undefined;
  } else {
    const rawCodes = lenient.locationCodes || [];
    const transformedCodes = rawCodes
      .map((code) => transformLocationCode(code, locationType))
      .filter((code): code is string => code !== null);

    // If lenient extraction failed to get codes but type is local, we might fail strict validation
    // But let's pass what we found to Zod
    if (transformedCodes.length > 0) locationCodes = transformedCodes;
  }

  // Fix guaranteed times
  let guaranteedTimes: string[] | undefined;
  if (lenient.guaranteedTimes && lenient.guaranteedTimes.length > 0) {
    guaranteedTimes = lenient.guaranteedTimes
      .map((tr) => normalizeTimeRange(tr))
      .filter((tr): tr is string => tr !== null);
    if (guaranteedTimes.length === 0) guaranteedTimes = undefined;
  }

  // Final strict validation
  return StrikeDataSchema.parse({
    startDate,
    endDate,
    locationType: locationType as 'NATIONAL' | 'REGIONAL',
    ...(locationCodes ? { locationCodes } : {}),
    ...(guaranteedTimes ? { guaranteedTimes } : {}),
  });
}

function normalizeDateString(dateStr: string): string {
  const cleaned = dateStr?.trim();
  // Simple check for yyyy-MM-dd HH:mm
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cleaned)) return `${cleaned}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(cleaned))
    return cleaned.replace('T', ' ').substring(0, 19);
  return cleaned; // Let Zod fail if still invalid
}

function transformLocationCode(
  input: string | number,
  locationType: LocationType,
): string | null {
  let cleaned: string;
  if (typeof input === 'number') {
    cleaned = input.toString().padStart(2, '0');
  } else {
    cleaned = input?.trim().toUpperCase();
  }
  if (locationType === 'REGIONAL') {
    if (isRegionCode(cleaned)) return cleaned;
    for (const [code, name] of regionsArr) {
      if (name.toUpperCase().includes(cleaned)) return code;
    }
  }
  return null;
}

function normalizeTimeRange(timeRange: string): string | null {
  const cleaned = timeRange?.trim().replace(/\s+/g, '').replace(/\./g, ':');
  if (timeRangeRegex.test(cleaned)) return cleaned;
  // Attempt fix H:mm-HH:mm
  const match = cleaned.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (match?.[1] && match[2] && match[3] && match[4]) {
    return `${match[1].padStart(2, '0')}:${match[2]}-${match[3].padStart(2, '0')}:${match[4]}`;
  }
  return null;
}

export function normalizeLenientResponse(
  raw: BenchmarkLenientStrike,
): BenchmarkStrike {
  if (!raw.isStrike || !raw.strikeData) {
    return { isStrike: false };
  }
  try {
    return {
      isStrike: true,
      strikeData: transformToValidStrikeData(raw.strikeData),
    };
  } catch (e) {
    console.debug('Failed to normalize lenient response:', e);
    return { isStrike: false };
  }
}
