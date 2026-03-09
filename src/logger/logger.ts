import { join } from 'node:path';
import { inspect } from 'node:util';
import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  // Start with a sensible default, it will be updated later.
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
  ),
  transports: [
    // Console transport with colorized output
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, context, meta, stack }) => {
          const contextStr = context ? `[${context}]` : '';

          // Format metadata objects using util.inspect for better readability
          const metaStr =
            Array.isArray(meta) && meta.length > 0
              ? ` ${meta
                  .map((m) => inspect(m, { colors: true, depth: null }))
                  .join(' ')}`
              : '';

          // Handle if message itself is an object
          const messageStr =
            typeof message === 'object' && message !== null
              ? inspect(message, { colors: true, depth: null })
              : message;

          // Format stack trace if it exists
          const stackStr = stack ? `\n${stack}` : '';

          return `[${timestamp}] ${level} ${contextStr} ${messageStr}${metaStr}${stackStr}`;
        }),
      ),
    }),
    // File transport with clean, non-colored JSON logs
    new transports.File({
      format: format.combine(format.timestamp(), format.json()),
      dirname: join(process.cwd(), 'logs'),
      filename: 'application.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

/**
 * Updates the log level of the global logger instance.
 * Call this after your environment variables are loaded.
 */
export function setLogLevel(level: string) {
  logger.level = level;
  // Also update the console transport's level if it's set independently
  const consoleTransport = logger.transports.find(
    (transport) => transport instanceof transports.Console,
  );
  if (consoleTransport) {
    consoleTransport.level = level;
  }
}
