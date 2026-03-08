import { jsonrepair } from 'jsonrepair';
import { omit } from 'lodash-es';
import { OpenAI } from 'openai';
import {
  BenchmarkLenientSchema,
  BenchmarkLenientStrike,
  BenchmarkStrike,
  BenchmarkStrikeSchema,
  normalizeLenientResponse,
  RawAiResponse,
} from '@/benchmarks/schemas/benchmark-strike.schema';
import { GroqModel } from '../../definitions/strike-parser.interface';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  AiModelAdapterOptions,
} from './ai-adapter.interface';
import { OpenAiAdapter } from './openai.adapter';

// Global rate limiter state
interface RateLimiterState {
  requestCount: number;
  tokenCount: number;
  windowStartTime: number;
}

const RATE_LIMITER_STATE: RateLimiterState = {
  requestCount: 0,
  tokenCount: 0,
  windowStartTime: Date.now(),
};

const REQUESTS_PER_MINUTE = 1000;
const TOKENS_PER_MINUTE = 300_000;
const MINUTE_MS = 60_000;

// Utility to delay execution
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Estimate tokens as prompt size / 4
const estimateTokens = (prompt: string): number => {
  return Math.ceil(prompt.length / 4);
};

// Check and update rate limiter state, waiting if necessary
const checkAndUpdateRateLimit = async (prompt: string): Promise<void> => {
  const estimatedTokens = estimateTokens(prompt);
  let waitTime = 0;

  // Keep checking until we can proceed
  while (true) {
    const now = Date.now();
    const windowElapsed = now - RATE_LIMITER_STATE.windowStartTime;

    // Reset window if needed
    if (windowElapsed > MINUTE_MS) {
      RATE_LIMITER_STATE.requestCount = 0;
      RATE_LIMITER_STATE.tokenCount = 0;
      RATE_LIMITER_STATE.windowStartTime = now;
    }

    const canProceedRequests =
      RATE_LIMITER_STATE.requestCount < REQUESTS_PER_MINUTE;
    const canProceedTokens =
      RATE_LIMITER_STATE.tokenCount + estimatedTokens <= TOKENS_PER_MINUTE;

    if (canProceedRequests && canProceedTokens) {
      // All checks passed, update state and return
      RATE_LIMITER_STATE.requestCount += 1;
      RATE_LIMITER_STATE.tokenCount += estimatedTokens;
      return;
    }

    // Calculate wait time until window resets
    const timeUntilReset = MINUTE_MS - windowElapsed;
    waitTime = Math.max(100, timeUntilReset); // Minimum 100ms backoff

    // Wait and retry
    await sleep(waitTime);
  }
};

// Extends OpenAI adapter to reuse normalization logic
export class GroqAdapter
  extends OpenAiAdapter
  implements AiModelAdapter<RawAiResponse>
{
  override readonly provider = 'groq';

  constructor(
    client: OpenAI,
    override readonly model: GroqModel,
  ) {
    super(client, model);
  }

  // Override estimation if needed, otherwise uses parent tiktoken fallback
  override async estimateInputTokens(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<number> {
    // Groq/Llama tokenizers are different, but GPT-4o tokenizer is a "good enough" proxy for cost est.
    return super.estimateInputTokens(prompt, { ...options });
  }

  // Override generate because Groq doesn't support SDK .responses.parse()
  override async generate(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    // Check rate limits, waiting if necessary
    await checkAndUpdateRateLimit(prompt);

    const schema = options.useLenientSchema
      ? BenchmarkLenientSchema
      : BenchmarkStrikeSchema;

    // Inject schema into prompt for Groq/Llama
    const schemaString = JSON.stringify(
      omit(schema.toJSONSchema(), ['$schema']),
    );
    const enrichedPrompt = `${prompt}\n\nReturn a JSON object matching this schema: ${schemaString}`;

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: enrichedPrompt }],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(jsonrepair(content));

    // Unwrap strikeData if it's an array (model sometimes wraps it incorrectly)
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

  // Override normalizeResponse to handle both strict and lenient schemas
  override normalizeResponse(
    rawOutput: unknown,
    options: AiModelAdapterOptions,
  ): BenchmarkStrike {
    if (options.useLenientSchema) {
      return normalizeLenientResponse(rawOutput as BenchmarkLenientStrike);
    }
    // Fall back to parent implementation for strict schema normalization
    return super.normalizeResponse(rawOutput, options);
  }
}
