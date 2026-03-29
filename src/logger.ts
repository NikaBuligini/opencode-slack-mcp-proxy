import pino, { type Logger, type LoggerOptions } from 'pino';

export type AppLogger = Logger;

const isPrettyLoggingEnabled = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

const transport = isPrettyLoggingEnabled
  ? pino.transport({
      targets: [
        {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      ],
    })
  : undefined;

export function createRootLogger(level: string): AppLogger {
  const loggerOptions: LoggerOptions = {
    level,
    base: undefined,
  };

  return pino(loggerOptions, transport);
}

export function createLogger(rootLogger: AppLogger, bindings?: Record<string, unknown>): AppLogger {
  if (!bindings) {
    return rootLogger;
  }

  return rootLogger.child(bindings);
}
