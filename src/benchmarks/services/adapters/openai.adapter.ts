import { zodTextFormat } from 'openai/helpers/zod';
import {
  BenchmarkAiOpenAILenientSchema,
  BenchmarkAiOpenAISchema,
} from '../../schemas/benchmark-ai-openai.schema';
import { RawAiResponse } from '../../schemas/benchmark-strike.schema';
import { AiModelAdapterOptions } from './ai-adapter.interface';
import { BaseOpenAiAdapter } from './base-openai.adapter';

export class OpenAiAdapter extends BaseOpenAiAdapter {
  readonly provider = 'openai';

  async generate(prompt: string, options: AiModelAdapterOptions) {
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
}
