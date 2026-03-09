import { SupportedModel } from '../../definitions/strike-parser.interface';
import {
  BenchmarkStrike,
  normalizeLenientResponse,
  RawAiResponse,
} from '../../schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  AiModelAdapterOptions,
  ProviderName,
} from './ai-adapter.interface';

export abstract class BaseAiAdapter implements AiModelAdapter<RawAiResponse> {
  abstract readonly provider: ProviderName;
  abstract readonly model: SupportedModel;

  // Leave API-specific implementations to the subclasses
  abstract estimateInputTokens(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<number>;
  abstract generate(
    prompt: string,
    options: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>>;

  // Centralized heavy normalization
  normalizeResponse(
    rawOutput: RawAiResponse,
    options: AiModelAdapterOptions,
  ): BenchmarkStrike {
    // Se è Lenient, applichiamo tutta la magia di pulizia
    if (options.useLenientSchema) {
      return normalizeLenientResponse(rawOutput);
    }

    // STRICT MODE PURO:
    // L'output è GIA' stato validato dallo Zod schema (BenchmarkStrikeSchema)
    // all'interno dei metodi generate() dei singoli adapter.
    // Nessun salvataggio manuale. Passa o muore.
    return rawOutput as BenchmarkStrike;
  }
}
