// biome-ignore-all lint/suspicious/noExplicitAny: for logging it's acceptable

import { Injectable, LoggerService } from '@nestjs/common';
import { logger } from './logger';

@Injectable()
export class AppLogger implements LoggerService {
  /**
   * Extracts context and metadata from optional parameters.
   * If the last parameter is a string, it's treated as the context.
   * The rest are returned as metadata.
   */

  private getContextAndMeta(optionalParams: any[]) {
    if (optionalParams.length === 0) {
      return { context: undefined, meta: [] };
    }
    const last = optionalParams[optionalParams.length - 1];
    if (typeof last === 'string') {
      return {
        context: last,
        meta: optionalParams.slice(0, -1),
      };
    }
    return { context: undefined, meta: optionalParams };
  }

  log(message: any, ...optionalParams: any[]) {
    const { context, meta } = this.getContextAndMeta(optionalParams);
    logger.log({ level: 'info', message, context, meta });
  }

  error(message: any, ...optionalParams: any[]) {
    const { context, meta } = this.getContextAndMeta(optionalParams);
    // Winston's error format will automatically handle the stack if the message is an Error object.
    logger.error({ message, context, meta });
  }

  warn(message: any, ...optionalParams: any[]) {
    const { context, meta } = this.getContextAndMeta(optionalParams);
    logger.warn({ message, context, meta });
  }

  debug(message: any, ...optionalParams: any[]) {
    const { context, meta } = this.getContextAndMeta(optionalParams);
    logger.debug({ message, context, meta });
  }

  verbose(message: any, ...optionalParams: any[]) {
    const { context, meta } = this.getContextAndMeta(optionalParams);
    logger.verbose({ message, context, meta });
  }
}
