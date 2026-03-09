import chalk from 'chalk';
import {
  isValidLocationCode,
  LocationCode,
} from '@/shared/constants/location-codes';
import { provincesArr } from '@/shared/constants/provinces';
import { regionsArr } from '@/shared/constants/regions';
import { LocationType } from '@/shared/enums';
import { SupportedModel } from '../../definitions/strike-parser.interface';
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
  ProviderName,
} from './ai-adapter.interface';

// Shared utility
const cleanDate = (d: string | null | undefined) => {
  if (!d) return '';
  let cleaned = d.replace('T', ' ').replace('Z', '');
  if (cleaned.split(':').length === 2) cleaned += ':00';
  return (cleaned.split('.')[0] ?? '').trim();
};

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
    if (options.useLenientSchema) {
      return normalizeLenientResponse(rawOutput);
    }

    const { isStrike, strikeData } = rawOutput as BenchmarkLenientStrike;
    if (!isStrike || !strikeData) return { isStrike: false };

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

      // Instead of throwing, fallback to isStrike: false
      console.warn(chalk.red('⚠️  Marking as NO STRIKE due to missing dates'));
      return { isStrike: false };
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
