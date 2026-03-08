import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BenchmarksModule } from './benchmarks/benchmarks.module';
import { envValidationSchema } from './envs/env.schema';
import { EnvsModule } from './envs/envs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: false, // use EnvsModule instead
      validate: (config) => {
        const result = envValidationSchema.safeParse(config);
        if (!result.success) {
          throw new Error(`Env validation error: ${result.error.message}`);
        }
        return result.data;
      },
    }),
    EnvsModule, // For validated and typed envs
    BenchmarksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
