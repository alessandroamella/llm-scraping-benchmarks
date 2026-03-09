import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { AppModule } from './app.module';
import { BenchmarksService } from './benchmarks/benchmarks.service';
import { AppLogger } from './logger/logger.service';

// Carica variabili d'ambiente
config();

async function bootstrap() {
  const appLogger = new AppLogger();

  // Crea il contesto dell'applicazione senza avviare server HTTP
  const app = await NestFactory.createApplicationContext(AppModule, {
    // logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    logger: appLogger,
  });

  const benchmarksService = app.get(BenchmarksService);

  console.log('🚀 Avvio del framework di Benchmark...');

  // Esegui i benchmark (assumendo che tu voglia triggerarli manualmente,
  // oppure togli runAllBenchmarks() da onModuleInit e chiamalo esplicitamente qui)
  await benchmarksService.runAllBenchmarks();

  console.log('✅ Benchmark completati.');
  await app.close();
}

bootstrap();
