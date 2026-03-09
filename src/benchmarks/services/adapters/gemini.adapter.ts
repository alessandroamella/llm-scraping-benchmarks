import { GoogleGenAI } from '@google/genai';
import { jsonrepair } from 'jsonrepair';
import { GeminiModel } from '../../definitions/strike-parser.interface';
import {
  BenchmarkLenientSchema,
  BenchmarkStrikeSchema,
  RawAiResponse,
} from '../../schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapterOptions,
} from './ai-adapter.interface';
import { BaseAiAdapter } from './base-ai.adapter';

export class GeminiAdapter extends BaseAiAdapter {
  readonly provider = 'google';

  constructor(
    private client: GoogleGenAI,
    readonly model: GeminiModel,
  ) {
    super();
  }

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
        responseJsonSchema: targetSchema.toJSONSchema(),
      },
    });

    const text = result.text || '{}';
    const raw = JSON.parse(jsonrepair(text));

    // Validate using our Zod schemas
    const validated = targetSchema.parse(raw) as RawAiResponse;

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
}
