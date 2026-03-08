import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Company } from '../data/ground-truth';
import { PreProcessingStrategy } from '../definitions/pre-processing-strategy.type';
import {
  IStrikeParser,
  ParseOptions,
  SupportedModel,
} from '../definitions/strike-parser.interface';
import { BenchmarkAiRunnerService } from '../services/benchmark-ai-runner.service';

export class PreComputedFileParser implements IStrikeParser {
  name: string;
  parserType = 'ai' as const;

  constructor(
    private runner: BenchmarkAiRunnerService,
    private strategy: PreProcessingStrategy,
    private companyName: Company,
    private model: SupportedModel,
    private lookupDir: string,
    private filenameMapper: (originalFile: string) => string | undefined,
  ) {
    this.name = `${model} [${strategy}]`;
  }

  async parse(_raw: string, options: ParseOptions) {
    const originalFile = options?.metadata?.fileName;
    const targetFilename = originalFile
      ? this.filenameMapper(originalFile)
      : null;
    const targetPath = targetFilename
      ? path.join(this.lookupDir, targetFilename)
      : null;

    if (!targetPath || !existsSync(targetPath)) {
      // return {
      //   data: { isStrike: false },
      //   metadata: { parserType: 'ai', info: 'File not found' },
      // } as const;
      throw new Error(
        `Pre-computed file not found for ${originalFile}. Expected at ${targetPath}`,
      );
    }

    const content = await readFile(targetPath, 'utf-8');
    return this.runner.parseWithAi(
      content,
      this.companyName,
      this.strategy,
      this.model,
      options.metadata.fileName,
      options.useLenientSchema,
    );
  }
}
