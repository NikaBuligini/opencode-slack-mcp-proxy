import type { ServerType } from '@hono/node-server';
import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { getConfig } from './config.js';
import { createRootLogger } from './logger.js';

const config = getConfig();
const logger = createRootLogger(config.logLevel);

const app = createApp({ config, rootLogger: logger });

const facadeServer = serve({
  fetch: app.fetch,
  hostname: config.facadeHost,
  port: config.facadePort,
});

const callbackServer = serve({
  fetch: app.fetch,
  hostname: config.callbackHost,
  port: config.callbackPort,
});

const servers: ServerType[] = [facadeServer, callbackServer];
let isShuttingDown = false;

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  logger.info({ signal }, 'Shutting down servers');

  const forceCloseTimer = setTimeout(() => {
    logger.warn('Force closing open connections');

    for (const server of servers) {
      if ('closeAllConnections' in server) {
        server.closeAllConnections();
      }

      if ('closeIdleConnections' in server) {
        server.closeIdleConnections();
      }
    }
  }, 5_000);

  forceCloseTimer.unref();

  try {
    await Promise.all(servers.map((server) => closeServer(server)));
    clearTimeout(forceCloseTimer);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    clearTimeout(forceCloseTimer);
    logger.error(
      {
        signal,
        message: error instanceof Error ? error.message : String(error),
      },
      'Shutdown failed',
    );
    process.exit(1);
  }
}

process.on('unhandledRejection', (error: unknown) => {
  logger.error(
    {
      message: error instanceof Error ? error.message : String(error),
    },
    'Unhandled promise rejection',
  );

  process.exitCode = 1;
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

logger.info(
  {
    facadeMcpUrl: `http://${config.facadeHost}:${config.facadePort}/mcp`,
    oauthProtectedResource: `http://${config.facadeHost}:${config.facadePort}/.well-known/oauth-protected-resource`,
    oauthAuthorizationServer: `http://${config.facadeHost}:${config.facadePort}/.well-known/oauth-authorization-server`,
    authorizeEndpoint: `http://${config.facadeHost}:${config.facadePort}/oauth/authorize`,
    tokenEndpoint: `http://${config.facadeHost}:${config.facadePort}/oauth/token`,
  },
  'Slack MCP facade listening',
);

logger.info(
  {
    callbackUrl: config.targetRedirectUri,
    callbackForwardTarget: `http://${config.opencodeHost}:${config.opencodePort}${config.opencodeCallbackPath}`,
  },
  'OAuth callback bridge listening',
);
