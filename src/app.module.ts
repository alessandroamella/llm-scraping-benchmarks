import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BenchmarksModule } from './benchmarks/benchmarks.module';
import { EnvsModule } from './envs/envs.module';
import { LoggerModule } from './logger/logger.module';

@Module({
  imports: [EnvsModule, LoggerModule, BenchmarksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
