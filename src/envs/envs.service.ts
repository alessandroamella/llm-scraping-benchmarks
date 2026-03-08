import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.schema';

@Injectable()
export class EnvsService {
  constructor(
    private configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  get<K extends keyof EnvironmentVariables>(key: K): EnvironmentVariables[K];
  get<K extends keyof EnvironmentVariables, D extends EnvironmentVariables[K]>(
    key: K,
    defaultValue: D,
  ): EnvironmentVariables[K] | D extends undefined
    ? EnvironmentVariables[K]
    : NonNullable<EnvironmentVariables[K]> | D;
  get<K extends keyof EnvironmentVariables>(
    key: K,
    defaultValue?: EnvironmentVariables[K],
  ): EnvironmentVariables[K] {
    const value = this.configService.get(key, { infer: true });
    return value !== undefined
      ? value
      : (defaultValue as EnvironmentVariables[K]);
  }
}
