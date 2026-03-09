/** biome-ignore-all lint/suspicious/noExplicitAny: we want to allow any for raw LLM outputs in the trace for maximum flexibility in debugging */
import { Company } from '../data/ground-truth';
import { BenchmarkStrike } from '../schemas/benchmark-strike.schema';
import { AiCostUsdBreakdown } from './strike-parser.interface';

interface AiTraceError {
  message: string;
  stack?: string;
  rawText?: string; // Captured if the LLM hallucinated bad JSON
  details?: any;
}

export interface AiTrace {
  timestamp: string;
  isCacheHit: boolean;
  request: {
    sourceName: Company;
    fileName: string;
    model: string;
    strategy: string;
    useLenientSchema: boolean;
    prompt: string;
  };
  response?: {
    rawOutput?: any;
    parsedData?: BenchmarkStrike;
    usage?: any;
    costUsd?: AiCostUsdBreakdown;
    durationMs: number;
    thoughts?: string;
  };
  error?: AiTraceError;
}

export const isAiTraceError = (error: unknown): error is AiTraceError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as any).message === 'string'
  );
};
