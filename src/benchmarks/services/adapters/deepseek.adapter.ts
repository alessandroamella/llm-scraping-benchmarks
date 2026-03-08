import { jsonrepair } from 'jsonrepair';
import { omit } from 'lodash-es';
import { OpenAI } from 'openai';
import { encoding_for_model } from 'tiktoken';
import {
  BenchmarkLenientSchema,
  BenchmarkLenientStrike,
  BenchmarkStrike,
  BenchmarkStrikeSchema,
  normalizeLenientResponse,
  RawAiResponse,
} from '@/benchmarks/schemas/benchmark-strike.schema';
import { DeepSeekModel } from '../../definitions/strike-parser.interface';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  AiModelAdapterOptions,
} from './ai-adapter.interface';

export class DeepSeekAdapter implements AiModelAdapter<RawAiResponse> {
  readonly provider = 'openai' as const;

  constructor(
    private client: OpenAI,
    readonly model: DeepSeekModel,
  ) {}

  async estimateInputTokens(prompt: string): Promise<number> {
    try {
      const enc = encoding_for_model('gpt-4o' as never);
      const tokens = enc.encode(prompt).length;
      enc.free();
      return tokens;
    } catch (e) {
      console.warn(
        'Token estimation failed for DeepSeek, falling back to heuristic. Error:',
        e,
      );
      return Math.ceil(prompt.length / 4);
    }
  }

  // Helper to get a clean JSON schema string for the prompt
  private getJsonSchemaString(useLenient: boolean): string {
    const zodSchema = useLenient
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;
    const jsonSchema = zodSchema.toJSONSchema();

    const schemaString = JSON.stringify(omit(jsonSchema, ['$schema']));

    return schemaString;
  }

  async generate(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    const schema = options.useLenientSchema
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;
    const schemaPrompt = this.getJsonSchemaString(options.useLenientSchema);

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that outputs JSON.
Respond with a valid JSON object matching this schema: ${schemaPrompt}`,
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    const rawContent = completion.choices[0]?.message?.content || '{}';
    const repaired = jsonrepair(rawContent);
    const parsed = JSON.parse(repaired);

    // Unwrap strikeData if it's an array (model sometimes wraps it incorrectly)
    if (parsed.strikeData && Array.isArray(parsed.strikeData)) {
      parsed.strikeData = parsed.strikeData[0] || null;
    }

    // This ensures the response actually matches the type before returning
    const validated = schema.parse(parsed) as RawAiResponse;

    return {
      rawOutput: validated,
      usage: {
        input: completion.usage?.prompt_tokens ?? 0,
        output: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0,
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
