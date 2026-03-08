import { intersection, isEqual, round, uniq } from 'lodash-es';
import { BenchmarkStrike } from '../schemas/benchmark-strike.schema';

export interface ComparisonResult {
  isExactMatch: boolean;
  score: number; // Same as F1 score for now (used for testing)
  precision: number;
  recall: number;
  f1: number;
  differences: string[];
}

// Helper to remove seconds from datetime string (yyyy-MM-dd HH:mm:ss -> yyyy-MM-dd HH:mm)
const normalizeDatetime = (datetime: string): string => {
  return datetime.substring(0, 16);
};

export function compareStrikes(
  generated: BenchmarkStrike,
  truth: BenchmarkStrike,
  disabledChecks: string[] = [],
): ComparisonResult {
  const differences: string[] = [];

  // We treat specific fields as "units of information" to retrieve
  // Fields: isStrike, startDate, endDate, locationType, guaranteedTimes
  let truePositives = 0; // Correctly found
  let falsePositives = 0; // Hallucinated or Wrong value
  let falseNegatives = 0; // Missed

  // Helper to compare
  const check = (
    field: string,
    genVal: unknown,
    truthVal: unknown,
    isDate = false,
  ) => {
    // If disabled, skip comparison
    if (disabledChecks.includes(field)) {
      return;
    }

    // Handling Arrays
    if (Array.isArray(truthVal)) {
      // Fix: Deduplicate arrays.
      // If the model generates duplicates (e.g. ['03', '03']), without uniq(),
      // correctItems would be 2, truth.length 1, leading to missedItems = -1 and Recall > 1.
      const g = Array.isArray(genVal) ? uniq(genVal) : [];
      const t = uniq(truthVal);

      // Intersection for arrays
      const correctItems = intersection(g, t).length;
      const extraItems = g.length - correctItems;
      const missedItems = t.length - correctItems;

      truePositives += correctItems;
      falsePositives += extraItems;
      falseNegatives += missedItems;

      if (extraItems > 0 || missedItems > 0) {
        differences.push(`${field}: Expected [${t}], got [${g}]`);
      }
    }
    // Handling Primitives/Objects
    else {
      // For dates, normalize to exclude seconds
      const genValToCompare =
        isDate && typeof genVal === 'string'
          ? normalizeDatetime(genVal)
          : genVal;
      const truthValToCompare =
        isDate && typeof truthVal === 'string'
          ? normalizeDatetime(truthVal)
          : truthVal;

      if (isEqual(genValToCompare, truthValToCompare)) {
        truePositives++;
      } else {
        // It's wrong: so it's a False Positive (wrong answer) AND False Negative (missed right answer)
        // Or we can just count it as 1 FN and 1 FP
        falsePositives++;
        falseNegatives++;
        differences.push(`${field}: Expected ${truthVal}, got ${genVal}`);
      }
    }
  };

  // Is strike?
  check('isStrike', generated.isStrike, truth.isStrike);

  if (generated.isStrike && truth.isStrike) {
    check(
      'startDate',
      generated.strikeData.startDate,
      truth.strikeData.startDate,
      true,
    );
    check(
      'endDate',
      generated.strikeData.endDate,
      truth.strikeData.endDate,
      true,
    );
    check(
      'locationType',
      generated.strikeData.locationType,
      truth.strikeData.locationType,
    );

    // Optional check for locationCodes
    if (truth.strikeData.locationCodes) {
      check(
        'locationCodes',
        generated.strikeData.locationCodes,
        truth.strikeData.locationCodes,
      );
    }

    check(
      'guaranteedTimes',
      generated.strikeData.guaranteedTimes,
      truth.strikeData.guaranteedTimes,
    );
  }

  // Calculate Metrics
  // Avoid division by zero
  const precision =
    truePositives + falsePositives === 0
      ? 0
      : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0
      ? 0
      : truePositives / (truePositives + falseNegatives);

  const f1 =
    precision + recall === 0
      ? 0
      : 2 * ((precision * recall) / (precision + recall));

  return {
    isExactMatch: f1 === 1,
    score: round(f1, 4),
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(f1, 4),
    differences,
  };
}
