import { Injectable } from '@nestjs/common';
import {
  IStrikeParser,
  ParseOptions,
  ParserResponse,
} from '../../definitions/strike-parser.interface';
import { BenchmarkAiRunnerService } from '../../services/benchmark-ai-runner.service';

@Injectable()
export class EavAiParser implements IStrikeParser {
  readonly name = 'EAV-AI';
  readonly parserType = 'ai';

  constructor(private readonly aiRunner: BenchmarkAiRunnerService) {}

  parse(html: string, options?: ParseOptions): Promise<ParserResponse> {
    if (!options?.model) {
      throw new Error('Model must be specified in options for AI parser');
    }
    if (!options?.strategy) {
      throw new Error('Strategy must be specified in options for AI parser');
    }
    return this.aiRunner.parseWithAi(
      html,
      'EAV',
      options.strategy,
      options.model,
      options.metadata.fileName,
      options.useLenientSchema,
    );
  }
}
