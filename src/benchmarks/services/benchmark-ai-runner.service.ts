import crypto from 'node:crypto';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import chalk from 'chalk';
import * as cheerio from 'cheerio';
import { round } from 'lodash-es';
import { OpenAI } from 'openai';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { EnvsService } from '@/envs/envs.service';
import type { Company } from '../data/ground-truth';
import { getPricing } from '../definitions/ai-pricing.const';
import { PreProcessingStrategy } from '../definitions/pre-processing-strategy.type';
import {
  AiCostUsdBreakdown,
  isDeepSeekModel,
  isGeminiModel,
  isGroqModel,
  isOpenAIModel,
  ParserMetadata,
  SupportedModel,
} from '../definitions/strike-parser.interface';
import {
  BenchmarkStrike,
  RawAiResponse,
} from '../schemas/benchmark-strike.schema';
import {
  AdapterGenerationResult,
  AiModelAdapter,
  ProviderName,
  TokenUsage,
} from './adapters/ai-adapter.interface';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { GroqAdapter } from './adapters/groq.adapter';
import { OpenAiAdapter } from './adapters/openai.adapter';

interface CachedAiResponse {
  data: BenchmarkStrike;
  metadata: ParserMetadata;
}

@Injectable()
export class BenchmarkAiRunnerService implements OnModuleInit {
  private readonly logger = new Logger(BenchmarkAiRunnerService.name);
  private genAI: GoogleGenAI;
  private openai: OpenAI;
  private groqOpenAi: OpenAI;
  private deepseek: OpenAI;

  private readonly failIfDomDistillationFails = true;

  private readonly cacheDir = path.join(
    process.cwd(),
    'src/benchmarks/.ai_cache',
  );
  private readonly manualConfirmationEnabled: boolean;

  constructor(private readonly envsService: EnvsService) {
    // Initialize Clients
    this.genAI = new GoogleGenAI({
      apiKey: this.envsService.get('GOOGLE_AI_API_KEY'),
    });
    this.openai = new OpenAI({
      apiKey: this.envsService.get('OPENAI_API_KEY'),
    });
    this.groqOpenAi = new OpenAI({
      apiKey: this.envsService.get('GROQ_API_KEY'),
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.deepseek = new OpenAI({
      apiKey: this.envsService.get('DEEPSEEK_API_KEY'),
      baseURL: 'https://api.deepseek.com',
    });

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    this.manualConfirmationEnabled = this.envsService.get(
      'MANUAL_CONFIRMATION_ENABLED',
    );
  }

  onModuleInit() {
    if (this.manualConfirmationEnabled) {
      if (this.envsService.get('PARSER_QUEUE_MAX_CONCURRENT') > 1) {
        // Error, we can only do manual confirmation with a concurrency of 1, else multiple threads will try to take the TTY input
        this.logger.error(
          chalk.red.bold(
            'MANUAL_CONFIRMATION_ENABLED cannot be true if PARSER_QUEUE_MAX_CONCURRENT is greater than 1. Please set PARSER_QUEUE_MAX_CONCURRENT to 1 in your .env file.',
          ),
        );
        process.exit(1);
      }
      this.logger.log(
        chalk.green.bold(
          '\nManual confirmation ENABLED. You will be prompted before each AI call.\n',
        ),
      );
    } else {
      this.logger.warn(
        chalk.red.bold(
          '\n⚠️  Manual confirmation DISABLED. AI will run automatically. ⚠️\n',
        ),
      );
    }
  }

  // --- Main Entry Point ---

  async parseWithAi(
    content: string,
    sourceName: Company,
    preProcessingStrategy: PreProcessingStrategy,
    model: SupportedModel,
    fileName: string,
    useLenientSchema: boolean,
  ): Promise<{ data: BenchmarkStrike; metadata: ParserMetadata }> {
    const cleanedContent = this.applyStrategy(
      content,
      preProcessingStrategy,
      sourceName,
      fileName,
    );
    const adapter = this.getAdapter(model);

    const getPromptFirstPart = (_provider: ProviderName) =>
      `You are a precise data extraction algorithm.
Analyze the following content regarding a strike from "${sourceName}".

IMPORTANT INSTRUCTIONS:
1. Decide if this document is actually announcing a new/upcoming strike.
   - If it is a cancellation/revocation of a strike, set isStrike to false.
   - If it is just providing information about participation (adesione) of a strike that already happened, set isStrike to false.
   - If it is providing real-time service updates (e.g., metro is open/closed during the strike), set isStrike to false.
   - ONLY set isStrike to true if it is an announcement of an upcoming strike.

2. If isStrike is true, extract the strike details:
   - Dates must be in 'yyyy-MM-dd HH:mm:ss' format.
   - Guaranteed times must be arrays of 'HH:mm-HH:mm' (omitted if not specified).
   - Location codes should be: 2-digit ISTAT for regions (e.g., "03" for Lombardia), 2-letter for provinces (e.g., "MI" for Milan), or omitted for national strikes.

Example Output if NOT a strike:
{
  "isStrike": false
}

Example Output if IS a strike:
{
  "isStrike": true,
  "strikeData": {
    "startDate": "2024-12-31 08:30:00",
    "endDate": "2024-12-31 12:30:00",
    "locationType": "REGION",
    "locationCodes": ["12"],
    "guaranteedTimes": ["06:00-09:00", "18:00-21:00"]
  }
}

Input Content (Pre-processing: ${preProcessingStrategy}):
`.trim();

    const prompt =
      `${getPromptFirstPart(adapter.provider)}\n${cleanedContent}`.trim();

    return this.runPipeline(
      adapter,
      prompt,
      sourceName,
      preProcessingStrategy,
      model,
      fileName,
      useLenientSchema,
    );
  }

  // --- Pipeline Logic ---

  private async runPipeline(
    adapter: AiModelAdapter,
    prompt: string,
    sourceName: Company,
    strategy: PreProcessingStrategy,
    model: SupportedModel,
    loggingFileName: string,
    useLenientSchema: boolean,
  ): Promise<{ data: BenchmarkStrike; metadata: ParserMetadata }> {
    const hashData = `${prompt}-${strategy}-${model}-${useLenientSchema}`;
    const hash = crypto.createHash('md5').update(hashData).digest('hex');
    const cachePath = path.join(this.cacheDir, `${hash}.json`);

    // Cache Check
    if (fs.existsSync(cachePath)) {
      try {
        const cached: CachedAiResponse = JSON.parse(
          await readFile(cachePath, 'utf-8'),
        );
        this.logger.log(
          `CACHE HIT [${hash.slice(0, 6)}] - Duration: ${cached.metadata.durationMs}ms`,
        );
        return cached;
      } catch (e) {
        this.logger.warn('Cache corrupted, fetching fresh...', e);
      }
    }

    const startTime = performance.now();
    this.logger.log(
      `CALLING ${adapter.provider.toUpperCase()} (${model}) for ${sourceName}...`,
    );

    // Estimation & Confirmation
    const inputTokens = await adapter.estimateInputTokens(prompt, {
      fileName: loggingFileName,
      useLenientSchema,
    });
    const rates = getPricing(model);
    const estimatedCost = (inputTokens / 1_000_000) * rates.input;

    this.logger.log(
      `\n${chalk.yellow.bold('⚠️  Pre-Flight Check')} ${chalk.gray(`[${sourceName}]`)}\n` +
        `${chalk.cyan('Est. Input Tokens:')} ${chalk.white.bold(inputTokens)}\n` +
        `${chalk.green('Est. Input Cost:')} $${estimatedCost.toFixed(6)}\n`,
    );

    if (this.manualConfirmationEnabled) {
      await this.handleManualConfirmation(prompt, sourceName);
    }

    try {
      // Execution
      this.logger.log(chalk.green.bold('Generating...'));
      const result: AdapterGenerationResult<RawAiResponse> =
        await adapter.generate(prompt, {
          fileName: `${sourceName}-${strategy}-${model}`,
          useLenientSchema,
        });

      // -TODO remove
      // console.log(
      //   '\n\n\n\nRaw AI Output:\n',
      //   chalk.gray(JSON.stringify(result.rawOutput, null, 2)),
      //   '\n\n\n\n',
      // );

      // Normalization & Cost Calculation
      const parsedData = adapter.normalizeResponse(result.rawOutput, {
        fileName: loggingFileName,
        useLenientSchema,
      });
      const costBreakdown = this.calculateFinalCost(model, result.usage);

      this.printUsageReport(sourceName, result.usage, costBreakdown);

      const durationMs = Math.round(performance.now() - startTime);

      const responseEnvelope: CachedAiResponse = {
        data: parsedData,
        metadata: {
          parserType: 'ai',
          durationMs,
          preProcessingStrategy: strategy,
          model,
          costUsd: costBreakdown,
          hash,
          tokens: {
            input: result.usage.input,
            output: result.usage.output,
            total: result.usage.total,
          },
        },
      };

      // Cache Write
      fs.writeFileSync(cachePath, JSON.stringify(responseEnvelope, null, 2));
      return responseEnvelope;
    } catch (error) {
      this.logger.error(
        `AI pipeline failed for ${sourceName} using model ${model} and adapter ${adapter.provider}`,
        error,
      );
      throw error;
    }
  }

  // --- Helper Methods ---

  private getAdapter(model: SupportedModel): AiModelAdapter<RawAiResponse> {
    if (isGeminiModel(model)) return new GeminiAdapter(this.genAI, model);
    if (isOpenAIModel(model)) return new OpenAiAdapter(this.openai, model);
    if (isGroqModel(model)) return new GroqAdapter(this.groqOpenAi, model);
    if (isDeepSeekModel(model))
      return new DeepSeekAdapter(this.deepseek, model);
    throw new Error(`Unsupported model: ${model}`);
  }

  private calculateFinalCost(
    model: SupportedModel,
    usage: TokenUsage,
  ): AiCostUsdBreakdown {
    const rates = getPricing(model);
    const inputCost = (usage.input / 1_000_000) * rates.input;
    const outputCost = (usage.output / 1_000_000) * rates.output;
    const thinkingCost = usage.thinking
      ? (usage.thinking / 1_000_000) * rates.output
      : 0;
    const cachedCost = usage.cached
      ? (usage.cached / 1_000_000) * rates.cached
      : 0;

    return {
      inputCost: round(inputCost, 8),
      outputCost: round(outputCost, 8),
      thinkingCost: round(thinkingCost, 8),
      cachedCost: round(cachedCost, 8),
      totalCost: round(inputCost + outputCost + thinkingCost + cachedCost, 8),
    };
  }

  private async handleManualConfirmation(prompt: string, sourceName: string) {
    let action: 'yes' | 'no' | 'show-prompt' = 'yes';
    do {
      action = await this.promptForAction(chalk.yellow('Continue? (y/n/p): '));
      if (action === 'show-prompt') {
        this.logger.log(
          `\n${chalk.blue.bold('📝 Full Prompt')} ${chalk.gray(`[${sourceName}]`)}\n` +
            `${chalk.gray('─'.repeat(50))}\n${chalk.white(prompt)}\n${chalk.gray('─'.repeat(50))}\n`,
        );
      }
    } while (action === 'show-prompt');

    if (action === 'no') process.exit(0);
  }

  private printUsageReport(
    sourceName: string,
    usage: TokenUsage,
    cost: AiCostUsdBreakdown,
  ) {
    this.logger.log(
      `\n${chalk.green.bold('🤖 Complete')} ${chalk.gray(`[${sourceName}]`)}\n` +
        `${chalk.blue.bold('📊 Usage:')} In: ${usage.input}, Out: ${usage.output}, Total: ${usage.total}\n` +
        `${chalk.green.bold('💰 Cost:')} ${chalk.green.bold(`$${cost.totalCost.toFixed(6)}`)}\n`,
    );
  }

  private async promptForAction(
    message: string,
  ): Promise<'yes' | 'no' | 'show-prompt'> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(message, (answer) => {
        rl.close();
        const a = answer.toLowerCase().trim();
        if (a === 'y' || a === 'yes') resolve('yes');
        else if (a === 'n' || a === 'no') resolve('no');
        else if (a === 'p' || a === 'prompt') resolve('show-prompt');
        else resolve('no');
      });
    });
  }

  private applyStrategy(
    content: string,
    strategy: PreProcessingStrategy,
    sourceName: Company,
    fileName: string,
  ): string {
    // For pre-computed strategies, the content passed here is already the
    // content read from the .md file by our new parser, so we pass it through.
    if (strategy === 'mineru-html' || strategy === 'jina-reader') {
      return content.trim();
    }

    // Handle Non-HTML (e.g., PDF text)
    if (!content.trim().startsWith('<')) {
      // Regardless of strategy, we usually want to normalize whitespace for plain text
      // unless specifically asked for 'raw' behavior
      return content.replace(/\s+/g, ' ').trim();
    }

    // Load Cheerio for HTML processing
    const $ = cheerio.load(content);

    if (strategy !== 'raw-html') {
      // For dom-distillation strategies, skip the pre-cleanup here: removing scripts/styles
      // changes nth-child indices and breaks structural selectors (e.g. div:nth-child(4)).
      // The same cleanup is applied AFTER extraction inside applyDomDistillation instead.
      if (
        strategy !== 'dom-distillation' &&
        strategy !== 'dom-distillation-markdown'
      ) {
        $(
          'script, style, svg, noscript, iframe, canvas, link[rel="stylesheet"], meta',
        ).remove();
      }

      // Clean attributes but KEEP table structure
      $('*').each((_, el) => {
        // don't do this for dom-distillation strategies, as we want to keep the original HTML structure for the distilled part, just without noise elements
        if (
          strategy === 'dom-distillation' ||
          strategy === 'dom-distillation-markdown'
        ) {
          return;
        }
        const attribs = $(el).attr();
        if (attribs)
          Object.keys(attribs).forEach((attr) => {
            // Keep colspan and rowspan for tables
            if (!['href', 'colspan', 'rowspan'].includes(attr)) {
              $(el).removeAttr(attr);
            }
          });
      });
    }

    switch (strategy) {
      case 'raw-html':
        return content;
      case 'basic-cleanup':
        return $.html().replace(/\s+/g, ' ').trim();
      case 'cheerio-text-only':
        return $('body').text().replace(/\s+/g, ' ').trim();
      case 'html-to-markdown': {
        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        });

        // Use the GFM plugin to preserve table structures
        turndownService.use(gfm);

        // Keep important semantic containers that might have meaningful text
        turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);

        return turndownService.turndown($.html());
      }
      // Case for unimplemented strategies to warn developer
      case 'dom-distillation':
        return this.applyDomDistillation($, sourceName, fileName);
      case 'dom-distillation-markdown': {
        const html = this.applyDomDistillation($, sourceName, fileName);
        const turndownService = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
        });
        turndownService.use(gfm);
        turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
        const converted = turndownService.turndown(html);

        return converted;
      }
      case 'flat-json':
        this.logger.warn(
          `Strategy ${strategy} is not implemented, falling back to basic-cleanup`,
        );
        return $.html().replace(/\s+/g, ' ').trim();
      default:
        return content;
    }
  }

  private applyDomDistillation(
    $: cheerio.CheerioAPI,
    sourceName: Company,
    _loggingFileName: string,
  ): string {
    // this.logger.debug(
    //   chalk.blue.bold(
    //     `DOM Distillation starting for ${sourceName} for file ${loggingFileName}`,
    //   ),
    // );

    // Extract metadata that might reside outside the main content container
    const contextParts: string[] = [];

    // Page Title (Often contains "Sciopero Trenord..." or dates)
    const pageTitle = $('title').text().trim();
    if (pageTitle) contextParts.push(`Page Title: ${pageTitle}`);

    let selectedHtml: string | null = null;

    if (sourceName === 'Trenord') {
      // this.logger.debug(chalk.cyan('Applying Trenord selectors...'));
      // Trenord Specific Context (Critical for dates and titles)
      // The manual parser relies on these, but they are often outside .container-content
      const dateNews = $('.date-news').text().trim();
      const headerTitle = $('.uppercase b').first().text().trim();

      if (dateNews) contextParts.push(`Date News: ${dateNews}`);
      if (headerTitle) contextParts.push(`Header: ${headerTitle}`);
      // print WHOLE DOM for debugging
      // this.logger.log(chalk.gray('Full DOM:'), $.html());

      // Logic ported from scrapers/trenord/index.ts
      // Start with container-foglia-news as root, then search within for container-content
      // This handles variable nesting of intermediate elements
      const fogliaNewsContainer = $('div.container-foglia-news');
      // log
      // this.logger.debug(
      //   chalk.gray(
      //     `Fogli-news containers found: ${fogliaNewsContainer.length}`,
      //   ),
      // );

      let contentElement = fogliaNewsContainer
        .find('div.container-content')
        .first();
      // this.logger.debug(
      //   chalk.gray(
      //     `Primary selector (foglia-news > container-content) found ${contentElement.length} elements`,
      //   ),
      // );

      // Fallback 1: Try finding .content within foglia-news that doesn't have tn-* classes
      if (contentElement.length === 0) {
        this.logger.debug(
          chalk.yellow(
            '⚠️ Primary selector failed, trying .content fallback...',
          ),
        );
        contentElement = fogliaNewsContainer
          .find('.content')
          .filter((_i, el) => {
            const classes = $(el).attr('class')?.split(/\s+/) || [];
            return !classes.some((cls) => cls.startsWith('tn-'));
          });
        this.logger.debug(
          chalk.gray(
            `Fallback .content selector found ${contentElement.length} elements`,
          ),
        );
      }

      // Fallback 2: Broad search without foglia-news constraint (handles structural variations)
      if (contentElement.length === 0) {
        this.logger.debug(
          chalk.yellow(
            '⚠️ Foglia-news scoped search failed, trying global scope...',
          ),
        );
        contentElement = $('.content').filter((_i, el) => {
          const classes = $(el).attr('class')?.split(/\s+/) || [];
          return !classes.some((cls) => cls.startsWith('tn-'));
        });
        this.logger.debug(
          chalk.gray(
            `Global .content fallback found ${contentElement.length} elements`,
          ),
        );
      }

      // Extract content (critical validation from scraper)
      const bodyHtml = contentElement.html();
      if (!bodyHtml) {
        this.logger.debug(
          chalk.yellow('⚠️ Could not extract content body (empty)'),
        );
        this.logger.warn(
          'Trenord DOM Distillation: Could not extract content body. Falling back to body.',
        );
        // Let fallback logic handle this by returning empty
        selectedHtml = null;
      } else {
        // Clean up extracted content before using it
        const $content = cheerio.load(bodyHtml);

        // Remove social media shares and SVG icons
        $content('.social').remove();
        $content('svg').remove();

        // Remove empty or whitespace-only paragraphs
        $content('p').each((_, el) => {
          const text = $content(el).text().trim();
          if (!text) {
            $content(el).remove();
          }
        });

        selectedHtml = $content.html() || bodyHtml;

        // Extract PDF links from the content (from scraper logic)
        const pdfHref = contentElement.find('a[href$=".pdf"]').attr('href');
        if (pdfHref) {
          // this.logger.debug(chalk.cyan(`Found PDF link: ${pdfHref}`));
          // Note: PDF downloading is async and not supported in this sync context.
          // In production scraper, downloadAndParsePdf is called here.
          // For benchmark, we include the PDF URL reference for context.
          selectedHtml += `\n\n<div class="pdf-attachment">PDF Document Found: ${pdfHref}</div>\n`;
        }
      }

      if (!selectedHtml) {
        this.logger.debug(
          chalk.yellow(
            '⚠️ No content extracted with DOM Distillation, falling back to body...',
          ),
        );
      }
    } else if (sourceName === 'Trenitalia') {
      // this.logger.debug(chalk.cyan('Applying Trenitalia selectors...'));
      // Trenitalia Breadcrumbs often contain "Regione" info
      const breadcrumbs = $('.breadcrumb, .breadCrumb')
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      if (breadcrumbs) contextParts.push(`Breadcrumbs: ${breadcrumbs}`);
      // Logic ported from scrapers/trenitalia/index.ts
      const articleContainers = $('.article');
      // this.logger.debug(
      //   chalk.gray(`Article containers found: ${articleContainers.length}`),
      // );

      if (articleContainers.length === 0) {
        this.logger.debug(
          chalk.yellow(
            '⚠️ No article containers found, extracting body content as fallback...',
          ),
        );
        // As a last resort, extract just the HTML inside the body tag
        const bodyContent = $('body').html();
        if (bodyContent) {
          this.logger.debug(
            chalk.gray(
              `Extracted body content: ${bodyContent.length} characters`,
            ),
          );
          selectedHtml = bodyContent;
        } else {
          selectedHtml = null;
        }
      } else {
        // Extract relevant sections
        const relevantSections: string[] = [];

        articleContainers.each((_, element) => {
          const articleHtml = $(element).html();
          if (articleHtml) {
            relevantSections.push(`<div class="article">${articleHtml}</div>`);
          }
        });

        if (relevantSections.length === 0) {
          this.logger.debug(
            chalk.yellow(
              '⚠️ No relevant sections found in articles, extracting body content as fallback...',
            ),
          );
          // As a last resort, extract just the HTML inside the body tag
          const bodyContent = $('body').html();
          if (bodyContent) {
            this.logger.debug(
              chalk.gray(
                `Extracted body content: ${bodyContent.length} characters`,
              ),
            );
            selectedHtml = bodyContent;
          } else {
            selectedHtml = null;
          }
        } else {
          selectedHtml = relevantSections.join('\n');
          this.logger.debug(
            chalk.gray(
              `Relevant sections collected: ${relevantSections.length}`,
            ),
          );
        }
      }
      // this.logger.debug(
      //   chalk.green(
      //     `✅ Trenitalia extraction: ${selectedHtml ? 'SUCCESS' : 'FAILED'}`,
      //   ),
      // );
    } else if (sourceName === 'EAV') {
      // this.logger.debug(chalk.cyan('Applying EAV selectors...'));
      // Logic ported from the EAV distillation script
      const article = $('article.post');
      // this.logger.debug(
      //   chalk.gray(`Article.post containers found: ${article.length}`),
      // );

      if (article.length === 0) {
        this.logger.debug(
          chalk.yellow(
            '⚠️ No article.post found, extracting body content as fallback...',
          ),
        );
        const bodyContent = $('body').html();
        if (bodyContent) {
          this.logger.debug(
            chalk.gray(
              `Extracted body content: ${bodyContent.length} characters`,
            ),
          );
          selectedHtml = bodyContent;
        } else {
          selectedHtml = null;
        }
      } else {
        // Remove unwanted elements
        article.find('section.container:nth-child(1)').remove();
        article.find('.offset-lg-2').remove();
        article.find('section#articolo-dettaglio-meta').remove();
        article.find('div.row:nth-child(3)').remove();

        // Remove HTML comments
        article
          .find('*')
          .contents()
          .filter((_i, el) => el.type === 'comment')
          .remove();

        selectedHtml = $.html(article);
        this.logger.debug(
          chalk.gray(
            `EAV article extracted: ${selectedHtml.length} characters`,
          ),
        );
      }
      // this.logger.debug(
      //   chalk.green(
      //     `✅ EAV extraction: ${selectedHtml ? 'SUCCESS' : 'FAILED'}`,
      //   ),
      // );
    } else if (sourceName === 'ATAC') {
      // ATAC extraction logic
      const mainContainer = $('div.elementor:nth-child(4)');

      if (mainContainer.length === 0) {
        if (this.failIfDomDistillationFails) {
          this.logger.error(
            chalk.red(
              'Critical: No target container (div.elementor:nth-child(4)) found for ATAC and fallback is disabled. Throwing error.',
            ),
          );
          throw new Error(
            'DOM Distillation failed for ATAC: Target container not found and fallback is not allowed.',
          );
        }
        this.logger.debug(
          chalk.yellow(
            '⚠️ No target container (div.elementor:nth-child(4)) found for ATAC, extracting body content as fallback...',
          ),
        );
        selectedHtml = $('body').html() || null;
      } else {
        // Remove the unwanted elements
        mainContainer.find('.elementor-element-628feb2').remove();
        mainContainer.find('.elementor-element-6ebb244').remove();

        selectedHtml = $.html(mainContainer);
        this.logger.debug(
          chalk.gray(
            `ATAC article extracted: ${selectedHtml.length} characters`,
          ),
        );
      }
    } else {
      this.logger.debug(chalk.red(`Unknown sourceName: ${sourceName}`));
      throw new Error(
        `No DOM Distillation strategy defined for source: ${sourceName}`,
      );
    }

    // Fallback if specific selectors fail (avoid sending empty string)
    if (!selectedHtml) {
      this.logger.debug(
        chalk.yellow('⚠️ No content extracted, falling back to body...'),
      );
      this.logger.warn(
        `DOM Distillation failed for ${sourceName} (selectors not found). Falling back to body content.`,
      );
      // no, this is an error, throw
      if (this.failIfDomDistillationFails) {
        throw new Error(
          `DOM Distillation failed for ${sourceName}: No content extracted and body fallback is not allowed.`,
        );
      }

      const bodyHtml = $('body').html();
      this.logger.debug(
        chalk.gray(`Body content length: ${bodyHtml?.length || 0}`),
      );
      return bodyHtml?.replace(/\s+/g, ' ').trim() || '';
    }

    if (selectedHtml) {
      // Load the distilled fragment into a new Cheerio instance
      // 'false' as the third argument prevents Cheerio from adding <html>/<body> tags
      const $distilled = cheerio.load(selectedHtml, null, false);

      // Apply the same noise-element cleanup that applyStrategy does for non-distillation
      // strategies, but here AFTER extraction so nth-child indices were intact during selection.
      $distilled(
        'script, style, svg, noscript, iframe, canvas, link[rel="stylesheet"], meta',
      ).remove();

      $distilled('*').each((_, el) => {
        const attribs = $distilled(el).attr();
        if (attribs) {
          Object.keys(attribs).forEach((attr) => {
            // Preserve only structurally significant attributes (tables and links)
            if (!['href', 'colspan', 'rowspan'].includes(attr)) {
              $distilled(el).removeAttr(attr);
            }
          });
        }
      });
      selectedHtml = $distilled.html();
    }

    // --- RECOMBINE CONTEXT + CONTENT ---
    // Inject the context at the top of the HTML so the LLM sees it first
    const contextHtml = contextParts.length
      ? `<div class="extracted-context">
            <h3>Context Metadata</h3>
            <ul>${contextParts.map((c) => `<li>${c}</li>`).join('')}</ul>
           </div><hr/>`
      : '';

    const finalHtml = contextHtml + (selectedHtml || '');

    const _finalLength = finalHtml.replace(/\s+/g, ' ').trim().length;
    // this.logger.debug(
    //   chalk.blue.bold(
    //     `DOM Distillation complete. Final content length: ${finalLength}`,
    //   ),
    // );

    // PRINT IT ALL FOR DEBUGGING
    // this.logger.log(chalk.gray('Selected HTML:'), finalHtml);

    const final = finalHtml.replace(/\s+/g, ' ').trim();

    // // -TODO remove - print selected HTML for debugging
    // if (sourceName === 'ATAC') {
    //   this.logger.log(
    //     chalk.gray('Selected HTML after distillation and cleanup:'),
    //     final,
    //   );
    // }

    return final;
  }
}
