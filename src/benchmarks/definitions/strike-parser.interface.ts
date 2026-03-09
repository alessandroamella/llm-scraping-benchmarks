import { BenchmarkStrike } from '../schemas/benchmark-strike.schema';
import { PreProcessingStrategy } from './pre-processing-strategy.type';

export const geminiModels = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
] as const;
export type GeminiModel = (typeof geminiModels)[number];
export const isGeminiModel = (model: string): model is GeminiModel => {
  return (geminiModels as readonly string[]).includes(model);
};

export const allOpenAIModels = [
  'gpt-5.2',
  'gpt-5.2-chat-latest',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5',
  'gpt-5.1-chat-latest',
  'gpt-5-chat-latest',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5-codex',
  'gpt-5-search-api',
  'gpt-5-mini',
  'gpt-5.1-codex-mini',
  'gpt-5-nano',
  'gpt-5.2-pro',
  'gpt-5-pro',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-05-13',
  'gpt-4o-mini',
] as const;
export type FullOpenAIModel = (typeof allOpenAIModels)[number];

export const openAIModels = [
  'gpt-5',
  'gpt-5-chat-latest',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-05-13',
  'gpt-4o-mini',
] as const; // tiktoken supports very few models
export type OpenAIModel = (typeof openAIModels)[number];
export const isOpenAIModel = (model: string): model is OpenAIModel => {
  return (openAIModels as readonly string[]).includes(model);
};

export const groqModels = [
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
] as const;
export type GroqModel = (typeof groqModels)[number];
export const isGroqModel = (model: string): model is GroqModel => {
  return (groqModels as readonly string[]).includes(model);
};

export const deepseekModels = ['deepseek-chat', 'deepseek-reasoner'] as const;
export type DeepSeekModel = (typeof deepseekModels)[number];

export const isDeepSeekModel = (model: string): model is DeepSeekModel => {
  return (deepseekModels as readonly string[]).includes(model);
};

export const supportedModels = [
  ...geminiModels,
  ...openAIModels,
  ...groqModels,
  ...deepseekModels,
] as const;
export type SupportedModel = (typeof supportedModels)[number];

interface BaseParserMetadata {
  durationMs?: number;
  info?: string;
}

export interface ManualParserMetadata extends BaseParserMetadata {
  parserType: 'manual';
}

export interface AiCostUsdBreakdown {
  inputCost: number;
  outputCost: number;
  cachedCost: number;
  thinkingCost: number;
  totalCost: number;
}

export interface AiParserMetadata extends BaseParserMetadata {
  parserType: 'ai';
  preProcessingStrategy?: PreProcessingStrategy;
  model?: SupportedModel;
  hash?: string;
  sourceFile?: string;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  costUsd?: AiCostUsdBreakdown;
  thoughts?: string;
}

export const isAiParserMetadata = (
  metadata: ParserMetadata,
): metadata is AiParserMetadata => {
  return metadata.parserType === 'ai';
};

export type ParserMetadata = ManualParserMetadata | AiParserMetadata;

export interface ParserResponse {
  data: BenchmarkStrike;
  metadata: ParserMetadata;
}

export interface ParseOptions {
  strategy?: PreProcessingStrategy;
  model: SupportedModel;
  metadata: { fileName: string };
  useLenientSchema: boolean;
}

export interface IStrikeParser {
  name: string;
  parserType: 'manual' | 'ai';
  parse(
    html: string,
    options: ParseOptions,
  ): Promise<ParserResponse> | ParserResponse;
}
