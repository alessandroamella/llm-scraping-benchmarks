import {
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
} from '@google/genai';
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

  private getResponseWithThoughts(response: GenerateContentResponse): {
    thoughts: string;
    answer: string;
  } {
    let thoughts = '';
    let answer = '';

    for (const part of response?.candidates?.[0]?.content?.parts ?? []) {
      if (!part.text) continue;
      if (part.thought) {
        thoughts += part.text;
      } else {
        answer += part.text;
      }
    }

    return { thoughts, answer };
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
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MEDIUM,
          includeThoughts: true,
        },
      },
    });

    const { answer, thoughts } = this.getResponseWithThoughts(result);
    const text = answer || '{}';

    try {
      const raw = JSON.parse(jsonrepair(text));
      const validated = targetSchema.parse(raw) as RawAiResponse;

      const usage = result.usageMetadata || {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
      };

      return {
        rawOutput: validated,
        thoughts,
        usage: {
          input: usage.promptTokenCount ?? 0,
          output: usage.candidatesTokenCount ?? 0,
          cached: usage.cachedContentTokenCount ?? 0,
          thinking: usage.thoughtsTokenCount ?? 0,
          total: usage.totalTokenCount ?? 0,
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: raw LLM outputs can be very flexible, and we want to capture them in the trace for debugging, even if they don't match our expected schema
    } catch (error: any) {
      // Attach raw string for tracing
      error.rawText = text;
      throw error;
    }
  }
}
