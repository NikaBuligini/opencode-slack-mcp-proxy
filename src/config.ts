import { z } from 'zod';

export type AppConfig = {
  facadeHost: string;
  facadePort: number;
  callbackHost: string;
  callbackPort: number;
  logLevel: string;
  opencodeHost: string;
  opencodePort: number;
  opencodeCallbackPath: string;
  requestTimeoutMs: number;
  targetRedirectUri: string;
};

const portSchema = z.coerce.number().int().positive();
const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const listenerHostSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value === '127.0.0.1' || value === 'localhost' || value === '0.0.0.0', {
    message: 'must be 127.0.0.1, localhost, or 0.0.0.0',
  });
const upstreamHostSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes('://'), {
    message: 'must not include a protocol',
  })
  .refine((value) => !value.includes('/'), {
    message: 'must not include a path',
  })
  .refine((value) => !value.includes('?') && !value.includes('#'), {
    message: 'must not include a query string or fragment',
  })
  .refine((value) => !/\s/.test(value), {
    message: 'must not include whitespace',
  });
const requestTimeoutSchema = z.coerce.number().int().min(1).max(120_000);

const envSchema = z.object({
  FACADE_HOST: listenerHostSchema.default('127.0.0.1'),
  FACADE_PORT: portSchema.optional(),
  PORT: portSchema.optional(),
  CALLBACK_HOST: listenerHostSchema.default('127.0.0.1'),
  CALLBACK_PORT: portSchema.optional(),
  LOG_LEVEL: logLevelSchema.default('info'),
  OPENCODE_HOST: upstreamHostSchema.default('127.0.0.1'),
  OPENCODE_PORT: portSchema.optional(),
  OPENCODE_CALLBACK_PATH: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.startsWith('/'), {
      message: 'must start with /',
    })
    .refine((value) => !value.includes('?') && !value.includes('#'), {
      message: 'must not include a query string or fragment',
    })
    .default('/mcp/oauth/callback'),
  REQUEST_TIMEOUT_MS: requestTimeoutSchema.default(10_000),
});

export function parseConfig(envInput: Record<string, string | undefined>): AppConfig {
  const env = envSchema.parse(envInput);
  const facadePort = env.FACADE_PORT ?? env.PORT ?? 3120;
  const callbackPort = env.CALLBACK_PORT ?? 3118;

  return {
    facadeHost: env.FACADE_HOST,
    facadePort,
    callbackHost: env.CALLBACK_HOST,
    callbackPort,
    logLevel: env.LOG_LEVEL,
    opencodeHost: env.OPENCODE_HOST,
    opencodePort: env.OPENCODE_PORT ?? 19876,
    opencodeCallbackPath: env.OPENCODE_CALLBACK_PATH,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    targetRedirectUri: `http://localhost:${callbackPort}/callback`,
  };
}

export function getConfig(): AppConfig {
  return parseConfig(process.env);
}
