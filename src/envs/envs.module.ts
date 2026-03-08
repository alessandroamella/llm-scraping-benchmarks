import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.schema';
import { EnvsService } from './envs.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const result = envValidationSchema.safeParse(config);
        if (!result.success) {
          throw new Error(`Env validation error: ${result.error.message}`);
        }
        return result.data;
      },
    }),
  ],
  providers: [EnvsService],
  exports: [EnvsService],
})
export class EnvsModule {}
