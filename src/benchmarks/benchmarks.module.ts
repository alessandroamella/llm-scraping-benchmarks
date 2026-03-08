import { Module } from '@nestjs/common';
import { BenchmarksService } from './benchmarks.service';
import { EavAiParser } from './parsers/eav/eav-ai.parser';
import { TrenitaliaAiParser } from './parsers/trenitalia/trenitalia-ai.parser';
import { TrenitaliaTperManualParser } from './parsers/trenitaliaTper/trenitalia-tper-manual.parser';
import { TrenordAiParser } from './parsers/trenord/trenord-ai.parser';
import { TrenordManualParser } from './parsers/trenord/trenord-manual.parser';
import { BenchmarkAiRunnerService } from './services/benchmark-ai-runner.service';

@Module({
  providers: [
    BenchmarksService,
    BenchmarkAiRunnerService,
    TrenitaliaTperManualParser,
    TrenordAiParser,
    TrenitaliaAiParser,
    TrenordManualParser,
    TrenitaliaTperManualParser,
    EavAiParser,
  ],
})
export class BenchmarksModule {}
