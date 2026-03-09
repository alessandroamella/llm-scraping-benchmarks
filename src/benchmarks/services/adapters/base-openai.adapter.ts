import { jsonrepair } from 'jsonrepair';
import { omit } from 'lodash-es';
import { OpenAI } from 'openai';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { SupportedModel } from '@/benchmarks/definitions/strike-parser.interface';
import {
  BenchmarkLenientSchema,
  BenchmarkStrikeSchema,
  RawAiResponse,
} from '@/benchmarks/schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapterOptions,
} from './ai-adapter.interface';
import { BaseAiAdapter } from './base-ai.adapter';

export abstract class BaseOpenAiAdapter extends BaseAiAdapter {
  constructor(
    protected client: OpenAI,
    readonly model: SupportedModel,
  ) {
    super();
  }

  // Shared token estimation for all OpenAI-compatible models
  async estimateInputTokens(
    prompt: string,
    { fileName }: AiModelAdapterOptions,
  ): Promise<number> {
    const modelMapping: Partial<Record<SupportedModel, TiktokenModel>> = {
      'llama-3.1-8b-instant': 'gpt-4o',
      'meta-llama/llama-4-scout-17b-16e-instruct': 'gpt-4o',
      'deepseek-chat': 'gpt-4o',
      'deepseek-reasoner': 'gpt-4o',
    };
    const encodingModel = modelMapping[this.model] || this.model;

    try {
      const enc = encoding_for_model(encodingModel as never);
      const tokens = enc.encode(prompt).length;
      enc.free();
      return tokens;
    } catch (e) {
      console.warn(
        `Token estimation failed for model ${this.model}, falling back to heuristic. Error:`,
        e,
        'file name:',
        fileName ?? 'unknown',
      );
      return Math.ceil(prompt.length / 4); // shared fallback
    }
  }

  // Shared generic JSON fallback generator (used by Groq and DeepSeek)
  protected async generateViaJsonMode(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    const schema = options.useLenientSchema
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;
    const schemaString = JSON.stringify(
      omit(schema.toJSONSchema(), ['$schema']),
    );

    // Inject schema prompt
    const enrichedPrompt = `${prompt}\n\nRespond with a valid JSON object matching this schema: ${schemaString}`;

    // before sending, debug print the enriched prompt if it contains a specific marker (e.g., "fileName" in options)
    if (options.fileName) {
      console.debug(
        `Enriched prompt for file ${options.fileName}:\n${enrichedPrompt}`,
      );
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: enrichedPrompt }],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(jsonrepair(content));

    // Fix the array wrap issue shared by both Groq and DeepSeek
    if (parsed.strikeData && Array.isArray(parsed.strikeData)) {
      parsed.strikeData = parsed.strikeData[0] || null;
    }

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
}
