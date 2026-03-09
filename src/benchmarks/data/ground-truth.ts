import { BenchmarkLenientStrike } from '../schemas/benchmark-strike.schema';
import * as groundTruthJson from './ground-truth.json';

export type Company = keyof typeof groundTruth;

/**
 * Map file names to their ground truth data for benchmark tests.
 */
export const groundTruth = groundTruthJson satisfies Record<
  string,
  Record<string, BenchmarkLenientStrike> // use Lenient for type errors
>;
