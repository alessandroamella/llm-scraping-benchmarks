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

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: enrichedPrompt }],
      response_format: { type: 'json_object' },
    });

    const message = completion.choices[0]?.message;
    const content = message?.content || '{}';

    // biome-ignore lint/suspicious/noExplicitAny: DeepSeek passes reasoning in this undocumented field via the OpenAI SDK
    const thoughts = (message as any)?.reasoning_content || undefined;

    try {
      const parsed = JSON.parse(jsonrepair(content));

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
        thoughts, // Return the thoughts so they trickle up
      };
      // biome-ignore lint/suspicious/noExplicitAny: raw LLM outputs can be very flexible, and we want to capture them in the trace for debugging, even if they don't match our expected schema
    } catch (error: any) {
      // Attach the raw string from the LLM so the tracer can save it
      error.rawText = content;
      throw error;
    }
  }
}
