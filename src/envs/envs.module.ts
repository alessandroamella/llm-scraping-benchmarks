import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvsService } from './envs.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [EnvsService],
  exports: [EnvsService],
})
export class EnvsModule {}
