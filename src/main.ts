import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import { BenchmarksModule } from './benchmarks/benchmarks.module';
import { BenchmarksService } from './benchmarks/benchmarks.service';

// Carica variabili d'ambiente
config();

async function bootstrap() {
  // Crea il contesto dell'applicazione senza avviare server HTTP
  const app = await NestFactory.createApplicationContext(BenchmarksModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
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
