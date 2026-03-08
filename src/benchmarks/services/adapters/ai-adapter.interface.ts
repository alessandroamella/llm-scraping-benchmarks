import { SupportedModel } from '../../definitions/strike-parser.interface';
import {
  BenchmarkStrike,
  RawAiResponse,
} from '../../schemas/benchmark-strike.schema';

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  thinking?: number;
  total: number;
}

export interface AdapterGenerationResult<T> {
  rawOutput: T;
  usage: TokenUsage;
}

export interface AiModelAdapterOptions {
  fileName: string;
  useLenientSchema: boolean;
}

export type ProviderName = 'google' | 'openai' | 'groq' | 'deepseek';

export interface AiModelAdapter<T extends RawAiResponse = RawAiResponse> {
  readonly provider: ProviderName;
  readonly model: SupportedModel;

  /**
   * Estimates tokens for the prompt before execution.
   * OpenAI/Groq use tiktoken/estimation, Gemini uses countTokens API.
   */
  estimateInputTokens(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<number>;

  /**
   * Executes the API call using the specific SDK.
   */
  generate(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<T>>;

  /**
   * Converts the raw API response (which might be loose JSON)
   * into the strict BenchmarkStrike schema, handling date formats
   * and location code mapping.
   */
  normalizeResponse(
    rawOutput: T,
    options: AiModelAdapterOptions,
  ): BenchmarkStrike;
}
