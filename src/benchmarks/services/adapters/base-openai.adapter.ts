import { jsonrepair } from 'jsonrepair';
import { omit } from 'lodash-es';
import { OpenAI } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { SupportedModel } from '@/benchmarks/definitions/strike-parser.interface';
import {
  BenchmarkAiOpenAILenientSchema,
  BenchmarkAiOpenAISchema,
} from '@/benchmarks/schemas/benchmark-ai-openai.schema';
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

  protected async generateWithResponsesAPI(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    const schema = options.useLenientSchema
      ? BenchmarkAiOpenAILenientSchema
      : BenchmarkAiOpenAISchema;

    const response = await this.client.responses.create({
      model: this.model as string,
      input: prompt,
      text: { format: zodTextFormat(schema, 'strike_extraction') },
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
    });

    // Extract message from output array
    const messageItem = response.output?.find(
      (item) => item.type === 'message',
    );
    if (!messageItem || messageItem.type !== 'message')
      throw new Error('OpenAI response missing message');

    const messageContent = messageItem.content?.[0];
    if (messageContent?.type !== 'output_text' || !messageContent?.text)
      throw new Error('OpenAI response missing text');

    // Extract reasoning summary if available
    const reasoningItem = response.output?.find(
      (item) => item.type === 'reasoning',
    );
    const thoughts =
      reasoningItem?.type === 'reasoning'
        ? reasoningItem.summary?.[0]?.text
        : undefined;

    // Parse the JSON response text with the schema
    let rawOutput: RawAiResponse;
    try {
      const parsed = JSON.parse(messageContent.text);
      const openAiValidated = schema.parse(parsed);

      // FIX PER STRICT MODE: Convertiamo i null di OpenAI in undefined
      // per combaciare perfettamente con il BenchmarkStrikeSchema / Ground Truth
      if (
        !options.useLenientSchema &&
        openAiValidated.isStrike &&
        openAiValidated.strikeData
      ) {
        for (const key of Object.keys(openAiValidated.strikeData)) {
          if (openAiValidated.strikeData[key] === null) {
            delete openAiValidated.strikeData[key];
          }
        }
      }

      rawOutput = openAiValidated as RawAiResponse;
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAI response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const usage = response.usage || {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    return {
      rawOutput,
      usage: {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      },
      thoughts,
    };
  }

  protected async generateWithCompletionsAPI(
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
