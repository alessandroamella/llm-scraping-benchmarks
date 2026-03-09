import { AiModelAdapterOptions } from './ai-adapter.interface';
import { BaseOpenAiAdapter } from './base-openai.adapter';

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

export class GroqAdapter extends BaseOpenAiAdapter {
  readonly provider = 'groq';

  async generate(prompt: string, options: AiModelAdapterOptions) {
    await checkAndUpdateRateLimit(prompt);
    return this.generateViaJsonMode(prompt, options);
  }
}
