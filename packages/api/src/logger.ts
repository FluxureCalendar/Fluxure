import pino from 'pino';
import { LOG_LEVEL } from './config.js';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: LOG_LEVEL,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/**
 * Create a child logger with a module context.
 * Usage: const log = createLogger('scheduler');
 */
export function createLogger(module: string): pino.Logger {
  return logger.child({ module });
}
