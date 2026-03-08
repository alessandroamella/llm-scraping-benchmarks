import { GoogleGenAI } from '@google/genai';
import { jsonrepair } from 'jsonrepair';
import { GeminiModel } from '../../definitions/strike-parser.interface';
import {
  BenchmarkLenientSchema,
  BenchmarkLenientStrike,
  BenchmarkStrike,
  BenchmarkStrikeSchema,
  normalizeLenientResponse,
  RawAiResponse,
} from '../../schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  AiModelAdapterOptions,
} from './ai-adapter.interface';

// Define what Google returns for either schema
interface GeminiRawOutput {
  isStrike: boolean;
  strikeData?: {
    startDate?: string;
    endDate?: string;
    locationType?: string;
    locationCodes?: string[] | null;
    guaranteedTimes?: string[] | null;
  };
}

export class GeminiAdapter implements AiModelAdapter<RawAiResponse> {
  readonly provider = 'google';

  constructor(
    private client: GoogleGenAI,
    readonly model: GeminiModel,
  ) {}

  async estimateInputTokens(prompt: string): Promise<number> {
    const result = await this.client.models.countTokens({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return result.totalTokens ?? 0;
  }

  async generate(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    const targetSchema = options.useLenientSchema
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: targetSchema.toJSONSchema(),
      },
    });

    const text = result.text || '{}';
    const raw = JSON.parse(jsonrepair(text)) as GeminiRawOutput;

    // Validate using our Zod schemas to ensure it matches RawAiResponse
    const zodSchema = options.useLenientSchema
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;
    const validated = zodSchema.parse(raw) as RawAiResponse;

    const usage = result.usageMetadata || {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    };

    return {
      rawOutput: validated,
      usage: {
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
        cached: usage.cachedContentTokenCount ?? 0,
        thinking: usage.thoughtsTokenCount ?? 0,
        total: usage.totalTokenCount ?? 0,
      },
    };
  }

  normalizeResponse(
    rawOutput: RawAiResponse,
    options: AiModelAdapterOptions,
  ): BenchmarkStrike {
    if (options.useLenientSchema) {
      return normalizeLenientResponse(rawOutput as BenchmarkLenientStrike);
    }
    return rawOutput as BenchmarkStrike;
  }
}
