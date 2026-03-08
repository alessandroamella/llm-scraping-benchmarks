import chalk from 'chalk';
import { OpenAI } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { encoding_for_model, TiktokenModel } from 'tiktoken';
import {
  isValidLocationCode,
  LocationCode,
} from '@/shared/constants/location-codes';
import { provincesArr } from '@/shared/constants/provinces';
import { regionsArr } from '@/shared/constants/regions';
import { LocationType } from '@/shared/enums';
import { SupportedModel } from '../../definitions/strike-parser.interface';
import {
  BenchmarkAiOpenAI,
  BenchmarkAiOpenAILenientSchema,
  BenchmarkAiOpenAISchema,
} from '../../schemas/benchmark-ai-openai.schema';
import {
  BenchmarkLenientStrike,
  BenchmarkStrike,
  BenchmarkStrikeSchema,
  normalizeLenientResponse,
  RawAiResponse,
  timeRangeRegex,
} from '../../schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  AiModelAdapterOptions,
} from './ai-adapter.interface';

// Fix Dates (Rimuovi 'T', secondi, millisecondi se presenti)
const cleanDate = (d: string | null | undefined) => {
  if (!d) return '';
  // Trasforma 2025-02-05T03:00:00.000Z -> 2025-02-05 03:00:00
  let cleaned = d.replace('T', ' ').replace('Z', '');
  if (cleaned.split(':').length === 2) cleaned += ':00'; // Aggiungi secondi se mancano
  return (cleaned.split('.')[0] ?? '').trim(); // Rimuovi ms
};

export class OpenAiAdapter implements AiModelAdapter<RawAiResponse> {
  readonly provider: 'openai' | 'groq' = 'openai';

  constructor(
    protected client: OpenAI,
    readonly model: SupportedModel,
  ) {}

  async estimateInputTokens(
    prompt: string,
    { fileName }: AiModelAdapterOptions,
  ): Promise<number> {
    const modelMapping: Partial<Record<SupportedModel, TiktokenModel>> = {
      'llama-3.1-8b-instant': 'gpt-4o',
      'meta-llama/llama-4-scout-17b-16e-instruct': 'gpt-4o',
      'deepseek-chat': 'gpt-4o',
      'deepseek-reasoner': 'gpt-4o',
      // Add other mappings as needed
    };
    const encodingModel = modelMapping[this.model] || this.model;

    try {
      // Cast to never then to model type to satisfy tiktoken's strict string union
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
      // Fallback
      return Math.ceil(prompt.length / 4);
    }
  }

  async generate(
    prompt: string,
    options?: AiModelAdapterOptions,
  ): Promise<AdapterGenerationResult<RawAiResponse>> {
    // Determine Schema
    const schema = options?.useLenientSchema
      ? BenchmarkAiOpenAILenientSchema
      : BenchmarkAiOpenAISchema;

    const response = await this.client.responses.parse({
      model: this.model as string,
      input: prompt,
      text: {
        format: zodTextFormat(schema, 'strike_extraction'),
      },
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

  normalizeResponse(
    rawOutput: unknown,
    options: AiModelAdapterOptions,
  ): BenchmarkStrike {
    // Lenient Handling
    if (options.useLenientSchema) {
      return normalizeLenientResponse(rawOutput as BenchmarkLenientStrike);
    }

    // Strict Handling (Existing Logic)
    const { isStrike, strikeData } = rawOutput as BenchmarkAiOpenAI;
    if (!isStrike || !strikeData) {
      return { isStrike: false };
    }

    // Fix Location Type (Il problema di Groq/Llama)
    let finalLocationType: LocationType = LocationType.REGION; // Default sicuro

    if (strikeData.locationType) {
      const rawType = strikeData.locationType.toUpperCase().trim();

      if (rawType.includes('NATION') || rawType.includes('GENERA')) {
        finalLocationType = LocationType.NATIONAL;
      } else if (rawType.includes('PROVINC')) {
        finalLocationType = LocationType.PROVINCE;
      } else if (rawType.includes('REGIO')) {
        // Cattura "REGION", "REGIONAL", "REGIONALE"
        finalLocationType = LocationType.REGION;
      }
    }

    const startDate = cleanDate(strikeData.startDate);
    const endDate = cleanDate(strikeData.endDate);

    // Se mancano le date, non possiamo farci molto, lasciamo che Zod finale esploda o gestiamo errore
    if (!startDate || !endDate) {
      // Fallback brutale o errore? Per il benchmark meglio lanciare errore e segnarlo come fail
      console.warn(
        chalk.yellow(
          `⚠️  Missing or unparseable dates in response. startDate: "${strikeData.startDate}", endDate: "${strikeData.endDate}"`,
        ),
      );
      // print full response
      console.log(
        chalk.yellow(
          `Full response: ${JSON.stringify(strikeData)}, file name: ${options?.fileName ?? 'unknown'}`,
        ),
      );

      // --- FIX START ---
      // Instead of throwing, fallback to isStrike: false
      console.warn(chalk.red('⚠️  Marking as NO STRIKE due to missing dates'));
      return { isStrike: false };
      // --- FIX END ---
    }

    // Fix Location Codes
    const cleanLocationCodes: LocationCode[] = [];
    if (
      finalLocationType !== LocationType.NATIONAL &&
      strikeData.locationCodes
    ) {
      strikeData.locationCodes.forEach((l) => {
        const cleanL = l.trim();

        // È già un codice valido?
        if (isValidLocationCode(cleanL)) {
          cleanLocationCodes.push(cleanL);
          return;
        }

        // È un nome di regione? (Lombardia -> 03)
        const foundRegion = regionsArr.find(
          ([_, name]) => name.toLowerCase() === cleanL.toLowerCase(),
        );
        if (foundRegion) {
          cleanLocationCodes.push(foundRegion[0]);
          return;
        }

        // È un nome di provincia? (Milano -> MI)
        const foundProv = provincesArr.find(
          ([name, _, __]) => name.toLowerCase() === cleanL.toLowerCase(),
        );
        if (foundProv) {
          cleanLocationCodes.push(foundProv[1]);
          return;
        }
      });
    }

    // Fix Guaranteed Times (validate HH:mm-HH:mm format)
    const cleanGuaranteedTimes: string[] | undefined =
      strikeData.guaranteedTimes
        ? strikeData.guaranteedTimes
            .map((t) => {
              const trimmed = t.trim().replaceAll('?', '');
              if (!timeRangeRegex.test(trimmed)) {
                console.log(
                  chalk.yellow(
                    `⚠️  Invalid guaranteed time format: "${trimmed}"`,
                  ),
                );
                return null;
              }
              return trimmed;
            })
            .filter((t): t is string => t !== null).length > 0
          ? strikeData.guaranteedTimes
              .map((t) => t.trim())
              .filter((t) => timeRangeRegex.test(t))
          : undefined
        : undefined;

    // Costruiamo l'oggetto finale che deve passare la validazione Zod STRETTA interna
    const data: BenchmarkStrike = {
      isStrike: true,
      strikeData: {
        startDate,
        endDate,
        locationType: finalLocationType,
        // Se NATIONAL, locationCodes deve essere undefined nello schema finale strict
        locationCodes:
          finalLocationType === LocationType.NATIONAL
            ? undefined
            : cleanLocationCodes,
        guaranteedTimes: cleanGuaranteedTimes,
      },
    };

    // Validazione finale (se fallisce qui, è colpa della nostra normalizzazione che non è bastata)
    return BenchmarkStrikeSchema.parse(data);
  }
}
