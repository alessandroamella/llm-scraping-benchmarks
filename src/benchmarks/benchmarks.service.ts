import crypto from 'node:crypto';
import fs from 'node:fs';
import path, { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import chalk from 'chalk';
import { format } from 'date-fns';
import { round, union } from 'lodash-es';
import pLimit from 'p-limit';
import { EnvsService } from '@/envs/envs.service';
import { type Company, groundTruth } from './data/ground-truth';
import { jinaFileMap } from './data/jina-files.map';
import { PreProcessingStrategy } from './definitions/pre-processing-strategy.type';
import {
  AiParserMetadata,
  IStrikeParser,
  isAiParserMetadata,
  ParserMetadata,
  SupportedModel,
} from './definitions/strike-parser.interface';
import { ATACManualParser } from './parsers/atac/atac-manual.parser';
import { ConfigurableAiParser } from './parsers/configurable-ai.parser';
import { EavManualParser } from './parsers/eav/eav-manual.parser';
import { PreComputedFileParser } from './parsers/precomputed-file-parser';
import { TrenordManualParser } from './parsers/trenord/trenord-manual.parser';
import { BenchmarkStrike } from './schemas/benchmark-strike.schema';
import { BenchmarkAiRunnerService } from './services/benchmark-ai-runner.service';
import { compareStrikes } from './utils/comparator.util';
import { messUpDom } from './utils/dom-chaos.util';

// Define the shape of the saved report
type BenchmarkResultDetail = Omit<ParserMetadata, 'thoughts'> & {
  file: string;
  source: Company;
  parser: string;
  score: number;
  isExactMatch: boolean;
  differences: string[];
  precision: number;
  recall: number;
  f1: number;
};

interface SummaryEntry {
  totalScore: number;
  count: number;
  perfect: number;
  avgPrecision: number;
  avgRecall: number;
  avgF1: number;
  totalCostUsd?: number;
  avgDuration: number;
  costPerFile?: number;
  errorRate: number;
}

interface SummaryStats {
  totalScore: number;
  count: number;
  perfect: number;
  totalPrecision: number;
  totalRecall: number;
  totalF1: number;
  totalDuration: number;
  errors: number;
}

interface BenchmarkReport {
  timestamp: string;
  summary: Record<string, SummaryEntry>;
  details: BenchmarkResultDetail[];
}

@Injectable()
export class BenchmarksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BenchmarksService.name);

  // Toggle this to run benchmarks
  private readonly useLenientSchema = true;
  private readonly includeManualInSuite = false;
  private readonly generateChaosDatasetFlag = false;

  private readonly customReportName = 'strict_with_SLM_all';
  // private readonly disabledChecks: string[] = ['locationType', 'locationCodes'];
  private readonly disabledChecks: string[] = [];

  private readonly enableResilienceSuite = false; // Toggle Resilience Suite
  private readonly enableAiSuites = true; // Toggle AI Suites
  private readonly enableSlmSuites = true; // Toggle SLM Suites (MinerU and Jina)

  // -----------------
  private readonly baseDir = path.join(process.cwd(), 'data');
  private readonly resultsDir = path.join(process.cwd(), 'results');

  // Adjust based on 💵💵 u wanna spend
  private CONCURRENCY_LIMIT: number;
  private confirmTimeoutId: NodeJS.Timeout | null = null;

  constructor(
    private readonly trenordManual: TrenordManualParser,
    private readonly atacManual: ATACManualParser,
    private readonly eavManual: EavManualParser,
    private readonly aiRunner: BenchmarkAiRunnerService,
    private readonly envsService: EnvsService,
  ) {
    this.CONCURRENCY_LIMIT = this.envsService.get(
      'PARSER_QUEUE_MAX_CONCURRENT',
    );
    this.logger.debug(
      `Concurrency limit set to ${this.CONCURRENCY_LIMIT} from environment variable`,
    );
  }

  // Aggiungi path per la cartella "Messed"
  private readonly trenordDir = path.join(this.baseDir, 'Trenord');
  private readonly trenordMessedDir = path.join(this.baseDir, 'Trenord-Messed');

  private readonly atacDir = path.join(this.baseDir, 'ATAC');
  private readonly atacMessedDir = path.join(this.baseDir, 'ATAC-Messed');

  private readonly eavDir = path.join(this.baseDir, 'EAV');
  private readonly eavMessedDir = path.join(this.baseDir, 'EAV-Messed');

  private getAiParsersForCompany(
    company: Company,
    models: SupportedModel[],
    strategies: PreProcessingStrategy[],
  ): IStrikeParser[] {
    const parsers: IStrikeParser[] = [];

    for (const model of models) {
      if (this.enableAiSuites) {
        for (const strategy of strategies) {
          parsers.push(
            new ConfigurableAiParser(
              this.aiRunner,
              strategy,
              company,
              model,
              this.useLenientSchema,
            ),
          );
        }
      }
      // Automatically add SLM parsers if enabled and their folders exist
      this.addSlmParsers(parsers, company, model);
    }

    return parsers;
  }

  private addSlmParsers(
    parsers: IStrikeParser[],
    company: Company,
    model: SupportedModel,
  ) {
    if (!this.enableSlmSuites) return;

    const mineruDir = path.join(this.baseDir, company, 'mineru-html');
    if (fs.existsSync(mineruDir)) {
      parsers.push(
        new PreComputedFileParser(
          this.aiRunner,
          'mineru-html',
          company,
          model,
          mineruDir,
          (f) => f,
        ),
      );
    }

    const jinaDir = path.join(this.baseDir, company, 'jina-reader');
    if (fs.existsSync(jinaDir)) {
      parsers.push(
        new PreComputedFileParser(
          this.aiRunner,
          'jina-reader',
          company,
          model,
          jinaDir,
          (f) => jinaFileMap[company]?.[f],
        ),
      );
    }
  }

  onModuleDestroy(): void {
    if (this.confirmTimeoutId) {
      this.logger.debug('Clearing confirm timeout on module destroy');
      clearTimeout(this.confirmTimeoutId);
      this.confirmTimeoutId = null;
    }
  }

  async onModuleInit() {
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }

    if (this.customReportName) {
      await sleep(100); // Give the logger a moment to print before the warning
      this.logger.warn(
        chalk.bold.yellowBright(
          `Custom report name is set to "${chalk.underline(this.customReportName)}". Please ensure this is intentional to avoid having bad report names.` +
            (this.disabledChecks.length > 0
              ? ` Moreover, beware of disabled checks: ${chalk.red(this.disabledChecks.join(', '))}`
              : ''),
        ),
      );
      await this.confirmCustomReportName();
    }

    if (this.disabledChecks.length > 0) {
      this.logger.warn(
        chalk.yellow(
          `The following checks are DISABLED in the benchmark: ${this.disabledChecks.join(
            ', ',
          )}. This may lead to inflated scores if the model hallucinates values in these fields but gets others right.`,
        ),
      );
    }

    // log concurrency limit
    this.logger.log(
      chalk.yellow(
        `Concurrency Limit for AI Parsing: ${this.CONCURRENCY_LIMIT}`,
      ),
    );
  }

  private async confirmCustomReportName(): Promise<void> {
    const TIMEOUT_MS = 30_000;

    let rl: readline.Interface | null = null;

    return Promise.race([
      new Promise<void>((resolve) => {
        rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(
          chalk.bold.cyan('Press ENTER to confirm and continue: '),
          () => {
            if (this.confirmTimeoutId) {
              clearTimeout(this.confirmTimeoutId);
              this.confirmTimeoutId = null;
            }
            rl?.close();
            resolve();
          },
        );
      }),
      new Promise<void>((resolve) => {
        this.confirmTimeoutId = setTimeout(() => {
          this.confirmTimeoutId = null;
          rl?.close();
          this.logger.warn(
            chalk.bold.yellowBright(
              `No input received after ${TIMEOUT_MS / 1000}s, continuing automatically...`,
            ),
          );
          resolve();
        }, TIMEOUT_MS);
      }),
    ]);
  }

  async runAllBenchmarks() {
    this.logger.log('Starting Multi-Model Benchmarks...');

    // to do once!
    if (this.generateChaosDatasetFlag) {
      this.generateChaosDataset();
    }

    // test matrix
    const baseStrategies: PreProcessingStrategy[] = [
      'basic-cleanup',
      'html-to-markdown',
      'dom-distillation',
      'dom-distillation-markdown',
      // 'raw-html', // molto costoso, non abilitare
    ];

    const models = [
      'gpt-5-nano',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'gemini-3.1-flash-lite-preview',
      'deepseek-chat',
    ] satisfies SupportedModel[];

    // Log which models we are testing
    this.logger.log(
      chalk.bold.blue(
        `Testing the following model and strategy combinations:\n${models
          .map((m) =>
            baseStrategies.map((s) => `  - ${m} with ${s}`).join('\n'),
          )
          .join('\n')}`,
      ),
    );

    // Preparazione parser Trenord
    const trenordParsers: IStrikeParser[] = [];
    if (this.includeManualInSuite) {
      trenordParsers.push(this.trenordManual);
    }
    trenordParsers.push(
      ...this.getAiParsersForCompany('Trenord', models, baseStrategies),
    );

    // Preparazione parser Trenitalia TPER (Solo basic-cleanup perché converte PDF prima)
    const trenitaliaTperParsers = this.getAiParsersForCompany(
      'Trenitalia TPER',
      models,
      ['basic-cleanup'],
    );

    // Preparazione parser EAV
    const eavParsers: IStrikeParser[] = [];
    if (this.includeManualInSuite) {
      eavParsers.push(this.eavManual);
    }
    eavParsers.push(
      ...this.getAiParsersForCompany('EAV', models, baseStrategies),
    );

    // Preparazione parser ATAC
    const atacParsers = this.getAiParsersForCompany(
      'ATAC',
      models,
      baseStrategies,
    );

    // Preparazione parser Trenitalia
    const trenitaliaParsers = this.getAiParsersForCompany(
      'Trenitalia',
      models,
      baseStrategies,
    );

    // Definizione delle suite con filtri data

    const allDetails: BenchmarkResultDetail[] = [];
    const summaryStats: Record<string, SummaryStats> = {};

    if (this.enableAiSuites || this.enableSlmSuites) {
      // Suite 1: Trenord (Standard)
      if (trenordParsers.length > 0) {
        const resultsTrenord = await this.runSuite('Trenord', trenordParsers);
        this.mergeStats(summaryStats, resultsTrenord.stats, '');
        allDetails.push(...resultsTrenord.details);
      }

      // Suite 2: Trenitalia TPER (Standard)
      if (trenitaliaTperParsers.length > 0) {
        const resultsTrenitaliaTper = await this.runSuite(
          'Trenitalia TPER',
          trenitaliaTperParsers,
        );
        this.mergeStats(summaryStats, resultsTrenitaliaTper.stats, '');
        allDetails.push(...resultsTrenitaliaTper.details);
      }

      // Suite 3: EAV
      if (eavParsers.length > 0) {
        const resultsEav = await this.runSuite('EAV', eavParsers);
        this.mergeStats(summaryStats, resultsEav.stats, '');
        allDetails.push(...resultsEav.details);
      }

      // Suite 4: Trenitalia
      if (trenitaliaParsers.length > 0) {
        const resultsTrenitalia = await this.runSuite(
          'Trenitalia',
          trenitaliaParsers,
        );
        this.mergeStats(summaryStats, resultsTrenitalia.stats, '');
        allDetails.push(...resultsTrenitalia.details);
      }

      // Suite: ATAC
      if (atacParsers.length > 0) {
        const resultsAtac = await this.runSuite('ATAC', atacParsers, {
          // customSuiteName: 'ATAC (No location checks)',
          // disabledChecksOverride: ['guaranteedTimes'],
        });
        this.mergeStats(summaryStats, resultsAtac.stats, '');
        allDetails.push(...resultsAtac.details);
      }
    }

    if (this.enableResilienceSuite) {
      this.logger.log(
        chalk.bgRed.white.bold(
          '\n--- Running RESILIENCE Suite (Chaos DOM) ---',
        ),
      );

      // Parser per ATAC - per ora disabilitato
      const _atacResilienceParsers: IStrikeParser[] = [
        this.atacManual,
        new ConfigurableAiParser(
          this.aiRunner,
          'html-to-markdown',
          'ATAC',
          'deepseek-chat',
          this.useLenientSchema,
        ),
      ];

      // Esegui la suite per ATAC
      // const resultsAtacChaos = await this.runSuite(
      //   'ATAC',
      //   atacResilienceParsers,
      //   {
      //     customSuiteName: 'ATAC Resilience (Chaos DOM)',
      //     directoryOverride: this.atacMessedDir,
      //   },
      // );

      // this.mergeStats(summaryStats, resultsAtacChaos.stats, ' [CHAOS]');
      // allDetails.push(
      //   ...resultsAtacChaos.details.map((d) => ({
      //     ...d,
      //     parser: `${d.parser} [CHAOS]`,
      //   })),
      // );

      // Suite 5: Resilienza (DOM Changes) (ora solo per Trenord)
      this.logger.log(
        chalk.bgRed.white.bold(
          '\n--- Running Suite: Trenord RESILIENCE (Messed DOM) ---',
        ),
      );

      // parser per questa suite:
      // manuale (ci si aspetta che fallisca)
      // AI (ci si aspetta che sopravviva) - Usiamo un modello veloce/economico
      const trenordResilienceParsers: IStrikeParser[] = [
        this.trenordManual,
        // facciamo solo deepseek perché va bene e costa poco
        // new ConfigurableAiParser(
        //   this.aiRunner,
        //   'html-to-markdown',
        //   'Trenord',
        //   'deepseek-chat',
        //   this.useLenientSchema,
        // ),
        // // mostriamo anche dom-distillation, pure lui dovrebbe crollare
        // new ConfigurableAiParser(
        //   this.aiRunner,
        //   'dom-distillation',
        //   'Trenord',
        //   'deepseek-chat',
        //   this.useLenientSchema,
        // ),
      ];
      // dynamic
      for (const strategy of [
        'basic-cleanup',
        'html-to-markdown',
      ] as PreProcessingStrategy[]) {
        // all models!
        for (const model of models) {
          trenordResilienceParsers.push(
            new ConfigurableAiParser(
              this.aiRunner,
              strategy,
              'Trenord',
              model,
              this.useLenientSchema,
            ),
          );
        }
      }

      // Nota: Passiamo 'Trenord-Messed' come nome della "company" per farlo cercare nella cartella giusta
      // Ma dobbiamo "ingannare" il runSuite perché groundTruth ha le chiavi basate sui file originali.
      // Il trucco è che i nomi dei file sono identici, cambia solo la cartella.

      // Hack: Aggiorniamo runSuite per accettare una directory override
      const resultsTrenordChaos = await this.runSuite(
        'Trenord', // Usa ground truth di Trenord
        trenordResilienceParsers,
        {
          customSuiteName: 'Trenord Resilience (Chaos DOM)',
          directoryOverride: this.trenordMessedDir,
        },
      );

      this.mergeStats(summaryStats, resultsTrenordChaos.stats, ' [CHAOS]');
      allDetails.push(
        ...resultsTrenordChaos.details.map((d) => ({
          ...d,
          parser: `${d.parser} [CHAOS]`,
        })),
      );

      // Suite 6: Resilienza EAV (DOM Changes)
      this.logger.log(
        chalk.bgRed.white.bold(
          '\n--- Running Suite: EAV RESILIENCE (Messed DOM) ---',
        ),
      );

      const eavResilienceParsers: IStrikeParser[] = [this.eavManual];
      // dynamic
      for (const strategy of [
        'basic-cleanup',
        'html-to-markdown',
      ] as PreProcessingStrategy[]) {
        // all models!
        for (const model of models) {
          eavResilienceParsers.push(
            new ConfigurableAiParser(
              this.aiRunner,
              strategy,
              'EAV',
              model,
              this.useLenientSchema,
            ),
          );
        }
      }

      const resultsEavChaos = await this.runSuite(
        'EAV', // Usa ground truth di EAV
        eavResilienceParsers,
        {
          customSuiteName: 'EAV Resilience (Chaos DOM)',
          directoryOverride: this.eavMessedDir,
        },
      );

      this.mergeStats(summaryStats, resultsEavChaos.stats, ' [CHAOS]');
      allDetails.push(
        ...resultsEavChaos.details.map((d) => ({
          ...d,
          parser: `${d.parser} [CHAOS]`,
        })),
      );
    }

    // Save Final Report
    this.saveReport(summaryStats, allDetails);
  }
  // ---------------------------------------

  private generateChaosDataset() {
    this.logger.log(
      chalk.magenta('Generating Chaos Dataset (Trenord & ATAC)...'),
    );

    const pairs = [
      { src: this.trenordDir, dest: this.trenordMessedDir },
      { src: this.atacDir, dest: this.atacMessedDir },
      { src: this.eavDir, dest: this.eavMessedDir },
    ];

    for (const pair of pairs) {
      if (!fs.existsSync(pair.dest))
        fs.mkdirSync(pair.dest, { recursive: true });
      const files = fs.readdirSync(pair.src).filter((f) => f.endsWith('.html'));
      for (const [i, file] of files.entries()) {
        this.logger.log(
          chalk.gray(
            `Processing ${file} (${i + 1}/${files.length}) in ${pair.src} -> ${pair.dest}`,
          ),
        );
        const content = fs.readFileSync(path.join(pair.src, file), 'utf-8');
        fs.writeFileSync(
          path.join(pair.dest, file),
          messUpDom(content),
          'utf-8',
        );
      }
    }
    this.logger.log(chalk.magenta('✅ Generated chaos dataset'));
  }

  private async runSuite(
    company: Company,
    parsers: IStrikeParser[],
    opts?: {
      customSuiteName?: string;
      filterFn?: (file: string, expected: BenchmarkStrike) => boolean;
      directoryOverride?: string;
      disabledChecksOverride?: string[];
    },
  ) {
    const suiteLabel = opts?.customSuiteName || company;
    this.logger.log(chalk.blue.bold(`--- Running Suite: ${suiteLabel} ---`));

    // Merge class-level disabled checks with the override (if any)
    const effectiveDisabledChecks = union(
      this.disabledChecks,
      opts?.disabledChecksOverride || [],
    );

    // Usa directoryOverride se presente, altrimenti la default
    const companyDir =
      opts?.directoryOverride || path.join(this.baseDir, company);

    // Merge static ground truth with synthetic data
    const truthData = groundTruth[company];

    if (Object.keys(truthData).length === 0) {
      this.logger.error(`No ground truth found for ${company}`);
      return { stats: {}, details: [] };
    }

    // Get all HTML files in the directory
    const files = Object.keys(truthData);

    // Print file number for this suite
    this.logger.log(
      `Found ${chalk.yellow(files.length.toString())} files to process for ${company}`,
    );

    const totalTasks = files.length * parsers.length; // Calculate total for this suite
    let completedTasks = 0;

    this.logger.log(
      chalk.yellow.bold(`Total combinations to process: ${totalTasks}`),
    );

    const results: Record<string, SummaryStats> = {};

    const details: BenchmarkResultDetail[] = [];

    // Initialize stats
    for (const parser of parsers) {
      results[parser.name] = {
        totalScore: 0,
        count: 0,
        perfect: 0,
        totalPrecision: 0,
        totalRecall: 0,
        totalF1: 0,
        totalDuration: 0,
        errors: 0,
      };
    }

    const limit = pLimit(this.CONCURRENCY_LIMIT);

    const tasks = files.flatMap((file) => {
      const expected = truthData[file as keyof typeof truthData];

      // Applica il filtro se fornito
      if (opts?.filterFn && !opts.filterFn(file, expected)) {
        return [];
      }

      const filePath = path.join(companyDir, file);

      if (!fs.existsSync(filePath)) {
        this.logger.warn(
          `File not found: ${file} (path: ${filePath}), skipping...`,
        );
        return [];
      }

      // Determine encoding based on file type
      const isPdf = file.toLowerCase().endsWith('.pdf');
      const fileContent = fs.readFileSync(filePath, isPdf ? 'binary' : 'utf-8');

      return parsers.flatMap((parser) => {
        return [
          limit(async () => {
            // Give the event loop 5ms to breathe
            await sleep(5);

            try {
              const startTime = performance.now();
              const response = await parser.parse(fileContent, {
                metadata: { fileName: basename(filePath) },
                useLenientSchema: this.useLenientSchema,
                // Pass model info for better logging in AI runner
                model: (parser as ConfigurableAiParser).model,
              });
              const realTimeDuration = performance.now() - startTime;

              // Use cached duration if provided by the parser, otherwise use actual execution time
              const duration =
                response.metadata?.durationMs ?? realTimeDuration;

              const comparison = compareStrikes(
                response.data,
                expected,
                effectiveDisabledChecks,
              );

              // Update stats
              const parserResult = results[parser.name];
              if (parserResult) {
                parserResult.count++;
                parserResult.totalScore += comparison.score;
                parserResult.totalPrecision += comparison.precision;
                parserResult.totalRecall += comparison.recall;
                parserResult.totalF1 += comparison.f1;
                parserResult.totalDuration += duration;
                if (comparison.isExactMatch) parserResult.perfect++;
              }

              // Extract thoughts so they don't bloat the final JSON report
              const metadata = response.metadata as AiParserMetadata;
              const { thoughts, ...cleanMetadata } = metadata;

              // Record Detail
              details.push({
                file,
                source: company,
                parser: parser.name,
                score: Number(comparison.score.toFixed(2)),
                isExactMatch: comparison.isExactMatch,
                differences: comparison.differences,
                precision: comparison.precision,
                recall: comparison.recall,
                f1: comparison.f1,
                ...cleanMetadata,
                durationMs: Math.round(duration),
                parserType: parser.parserType,
              });

              // --- PROGRESS TRACKING LOGIC
              completedTasks++;
              const progressPercent = (
                (completedTasks / totalTasks) *
                100
              ).toFixed(1);
              const icon = comparison.isExactMatch ? '✅' : '⚠️';

              const scoreStr = (comparison.score * 100).toFixed(2);
              const chalkFn =
                comparison.score < 0.2
                  ? chalk.red
                  : comparison.score > 0.9
                    ? chalk.green
                    : chalk.white;

              // This line prints the progress bar style log
              this.logger.log(
                `${chalk.magenta(`[${completedTasks}/${totalTasks}]`)} ` +
                  `${chalk.cyan(`(${progressPercent}%)`)} ` +
                  `${icon} ${chalk.white(parser.name)} on ${chalk.gray(file)} (${chalkFn(
                    `${scoreStr}%`,
                  )}) - ${Math.round(duration)}ms`,
              );
            } catch (e) {
              this.logger.error(`Parser ${parser.name} failed on ${file}`, e);
              if (parser.name in results) {
                // biome-ignore lint/style/noNonNullAssertion: literally just checked
                results[parser.name]!.errors++;
              }
            }
          }),
        ];
      });
    });

    await Promise.all(tasks);

    return { stats: results, details };
  }

  private mergeStats(
    target: Record<string, SummaryStats>,
    source: Record<string, SummaryStats>,
    suffix: string,
  ) {
    for (const [key, val] of Object.entries(source)) {
      const newKey = key + suffix;
      if (!target[newKey]) {
        target[newKey] = { ...val };
      } else {
        target[newKey].totalScore += val.totalScore;
        target[newKey].count += val.count;
        target[newKey].perfect += val.perfect;
        target[newKey].totalPrecision += val.totalPrecision;
        target[newKey].totalRecall += val.totalRecall;
        target[newKey].totalF1 += val.totalF1;
        target[newKey].totalDuration += val.totalDuration;
        target[newKey].errors += val.errors;
      }
    }
  }

  private saveReport(
    stats: Record<string, SummaryStats>,
    details: BenchmarkResultDetail[],
  ) {
    // Check if report is empty
    if (Object.keys(stats).length === 0 || details.length === 0) {
      this.logger.warn(
        chalk.yellow(
          '⚠️ Report is empty, no benchmarks were run or results collected. Skipping save ⚠️',
        ),
      );
      return;
    }

    // Calculate averages for summary
    const formattedSummary: Record<string, SummaryEntry> = {};
    for (const [name, stat] of Object.entries(stats)) {
      const parserDetails = details.filter((d) => d.parser === name);
      const totalCost = parserDetails.reduce(
        (sum, d) =>
          sum + ((isAiParserMetadata(d) && d.costUsd?.totalCost) || 0),
        0,
      );

      formattedSummary[name] = {
        totalScore: round(stat.totalScore, 2),
        count: stat.count,
        perfect: stat.perfect,
        avgPrecision: round(stat.totalPrecision / stat.count, 4),
        avgRecall: round(stat.totalRecall / stat.count, 4),
        avgF1: round(stat.totalF1 / stat.count, 4),
        // Time Stats
        avgDuration: round(stat.totalDuration / stat.count, 2),

        // Error Stats
        errorRate: round(stat.errors / (stat.count + stat.errors), 4),

        // Unit Economics (Cost Per File)
        ...(totalCost > 0 && {
          totalCostUsd: round(totalCost, 4),
          costPerFile: round(totalCost / stat.count, 5),
        }),
      };
    }

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      summary: formattedSummary,
      details: details,
    };

    // Helper to extract only quality metrics (excluding performance/cost metrics)
    const getQualitySignature = (
      summary: Record<string, SummaryEntry>,
      details: BenchmarkResultDetail[],
    ) => {
      const qualitySummary = Object.entries(summary).reduce(
        (acc, [name, entry]) => {
          acc[name] = {
            count: entry.count,
            perfect: entry.perfect,
            avgPrecision: entry.avgPrecision,
            avgRecall: entry.avgRecall,
            avgF1: entry.avgF1,
            errorRate: entry.errorRate,
          };
          return acc;
        },
        {} as Record<
          string,
          {
            count: number;
            perfect: number;
            avgPrecision: number;
            avgRecall: number;
            avgF1: number;
            errorRate: number;
          }
        >,
      );

      const qualityDetails = details.map((d) => ({
        file: d.file,
        source: d.source,
        parser: d.parser,
        isExactMatch: d.isExactMatch,
        precision: d.precision,
        recall: d.recall,
        f1: d.f1,
      }));

      return JSON.stringify({
        summary: qualitySummary,
        details: qualityDetails,
      });
    };

    // Print Console Summary Table (before checking for duplicates)
    console.table(
      Object.entries(formattedSummary).map(([name, s]) => ({
        Parser: name,
        'F1 Score': s.avgF1,
        Precision: s.avgPrecision,
        Recall: s.avgRecall,
        'Perf. Matches': `${s.perfect}/${s.count}`,
        Cost: s.totalCostUsd || 'N/A',
      })),
    );

    // Check if an identical report already exists (based on quality metrics only)
    const reportHash = crypto
      .createHash('sha256')
      .update(getQualitySignature(formattedSummary, details))
      .digest('hex');

    const existingFiles = fs.readdirSync(this.resultsDir);
    for (const file of existingFiles) {
      if (!file.startsWith('benchmark_run_')) continue;

      const filePath = path.join(this.resultsDir, file);
      try {
        const existingContent = fs.readFileSync(filePath, 'utf-8');
        const existingReport = JSON.parse(existingContent) as BenchmarkReport;
        const existingHash = crypto
          .createHash('sha256')
          .update(
            getQualitySignature(existingReport.summary, existingReport.details),
          )
          .digest('hex');

        if (reportHash === existingHash) {
          this.logger.log(
            chalk.bold.cyan(`📋 Identical report already exists: ${file}`),
          );
          return;
        }
      } catch (e) {
        this.logger.warn(`Could not read existing report: ${file}`, e);
      }
    }

    // Only save if it's different from existing reports
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');

    const namePart = this.customReportName ? `_${this.customReportName}` : '';
    const filename = `benchmark_run${namePart}_${timestamp}.json`;

    const outputPath = path.join(this.resultsDir, filename);

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    this.logger.log(chalk.bold.magenta(`\n💾 Report saved to: ${outputPath}`));
  }
}
