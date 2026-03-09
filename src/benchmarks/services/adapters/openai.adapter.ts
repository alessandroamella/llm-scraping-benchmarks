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

    const response = await this.client.responses.parse({
      model: this.model as string,
      input: prompt,
      text: { format: zodTextFormat(schema, 'strike_extraction') },
    });

    const rawOutput = response.output_parsed;
    if (!rawOutput) throw new Error('OpenAI returned null parsed output');

    const usage = response.usage || {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    return {
      rawOutput: rawOutput as RawAiResponse,
      usage: {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      },
    };
  }
}
