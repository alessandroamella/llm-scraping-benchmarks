import { SupportedModel } from './strike-parser.interface';

interface PricingRate {
  input: number;
  output: number;
  cached: number;
}

// Rates per 1M tokens
export const MODEL_PRICING: Partial<Record<SupportedModel, PricingRate>> = {
  // Gemini
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached: 0.01 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-3-flash-preview': { input: 0.5, output: 3.0, cached: 0.05 },
  // Note: Gemini Pro logic (long prompt vs short) is complex, handled via simplified average or specific logic if needed.
  // Not even considering it as it's too expensive, don't wanna spend $10 on a single run during testing, but leaving here for reference.
  // 'gemini-3-pro-preview': { input: 2.0, output: 12.0, cached: 0.2 },

  // GPT-5 / 4.1 Series (Placeholder rates based on current generic logic)
  'gpt-5': { input: 1.25, output: 10.0, cached: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2.0, cached: 0.025 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cached: 0.005 },
  'gpt-4o': { input: 2.5, output: 10.0, cached: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cached: 0.075 },

  // Groq / Llama
  'meta-llama/llama-4-scout-17b-16e-instruct': {
    input: 0.11,
    output: 0.34,
    cached: 0,
  },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08, cached: 0 },

  // DeepSeek
  'deepseek-chat': { input: 0.028, output: 0.28, cached: 0 },
};

export const getPricing = (model: SupportedModel): PricingRate => {
  const price = MODEL_PRICING[model];
  if (price) return price;

  // Logic to find generic gpt-4o price if 'gpt-4o-2024-08-06' isn't explicitly listed
  // For example, map variations to base models
  if (model.includes('gpt-4o') && model.includes('mini'))
    return (
      MODEL_PRICING['gpt-4o-mini'] || {
        input: 0.15,
        output: 0.6,
        cached: 0.075,
      }
    );
  if (model.includes('gpt-4o'))
    return (
      MODEL_PRICING['gpt-4o'] || { input: 2.5, output: 10.0, cached: 1.25 }
    );
  if (model.includes('gpt-5') && model.includes('mini'))
    return (
      MODEL_PRICING['gpt-5-mini'] || { input: 0.25, output: 2.0, cached: 0.025 }
    );
  if (model.includes('gpt-5'))
    return (
      MODEL_PRICING['gpt-5'] || { input: 1.25, output: 10.0, cached: 0.125 }
    );

  // If no match, throw error instead of default expensive fallback
  throw new Error(`No pricing found for model: ${model}`);
};
