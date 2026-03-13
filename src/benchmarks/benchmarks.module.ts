import { Module } from '@nestjs/common';
import { EnvsModule } from '@/envs/envs.module';
import { BenchmarksService } from './benchmarks.service';
import { ATACManualParser } from './parsers/atac/atac-manual.parser';
import { EavAiParser } from './parsers/eav/eav-ai.parser';
import { EavManualParser } from './parsers/eav/eav-manual.parser';
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
    ATACManualParser,
    EavManualParser,
  ],
  imports: [EnvsModule],
})
export class BenchmarksModule {}
