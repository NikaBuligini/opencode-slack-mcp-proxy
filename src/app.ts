import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestOptions,
} from 'node:http';
import https from 'node:https';

import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import type { Env } from 'hono';

import type { AppConfig } from './config.js';
import { SLACK_TOKEN_URL } from './constants.js';
import {
  copyNodeHeaders,
  filterFetchResponseHeaders,
  sanitizeHeaders,
  toHeaders,
} from './http-utils.js';
import { createLogger, type AppLogger } from './logger.js';
import { sanitize, sanitizeText } from './sanitize.js';
import {
  buildSlackAuthorizeUrl,
  fetchAuthorizationServerMetadata,
  fetchProtectedResourceMetadata,
  type JsonFetcher,
} from './slack.js';

type FacadeUrls = {
  origin: string;
  mcp: string;
  protectedResource: string;
  authorizationServer: string;
  authorize: string;
  token: string;
};

type NodeEnv = Env & { Bindings: HttpBindings };

type NodeClientRequest = {
  setTimeout: (timeoutMs: number, callback: () => void) => unknown;
  on: (event: 'error', listener: (error: Error) => void) => unknown;
  write: (chunk: Buffer | string) => unknown;
  end: () => unknown;
  destroy: (error?: Error) => void;
};

type NodeRequestFunction = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => NodeClientRequest;

type NodeRequestModule = {
  request: NodeRequestFunction;
};

type AppDependencies = {
  fetcher: typeof fetch;
  jsonFetcher: JsonFetcher;
  httpModule: NodeRequestModule;
  httpsModule: NodeRequestModule;
};

const DEFAULT_ERROR_RESPONSE = 'Request failed\n';
const CALLBACK_PROXY_ERROR_RESPONSE = 'Callback proxy request failed\n';

function buildFacadeUrls(request: Request): FacadeUrls {
  const origin = new URL(request.url).origin;

  return {
    origin,
    mcp: `${origin}/mcp`,
    protectedResource: `${origin}/.well-known/oauth-protected-resource`,
    authorizationServer: `${origin}/.well-known/oauth-authorization-server`,
    authorize: `${origin}/oauth/authorize`,
    token: `${origin}/oauth/token`,
  };
}

function rewriteWwwAuthenticateHeader(
  value: string | string[] | undefined,
  protectedResourceUrl: string,
): string | string[] | undefined {
  if (!value) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (entry) => rewriteWwwAuthenticateHeader(entry, protectedResourceUrl) as string,
    );
  }

  return value.replace(
    /resource_metadata="https:\/\/mcp\.slack\.com\/.well-known\/oauth-protected-resource"/gi,
    `resource_metadata="${protectedResourceUrl}"`,
  );
}

export function parseTokenRequestParams(
  contentType: string,
  requestUrl: URL,
  bodyText: string,
): URLSearchParams {
  const normalizedContentType = contentType.split(';', 1)[0].trim().toLowerCase();

  if (normalizedContentType === 'application/json') {
    const parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }

    return params;
  }

  if (bodyText) {
    return new URLSearchParams(bodyText);
  }

  return new URLSearchParams(requestUrl.searchParams);
}

function createMcpUpstreamHeaders(nodeRequest: IncomingMessage): OutgoingHttpHeaders {
  return {
    ...nodeRequest.headers,
    host: 'mcp.slack.com',
    connection: 'close',
  };
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  timeout.unref?.();

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
    },
  };
}

function destroyRequestWithError(
  request: { destroy: (error?: Error) => void },
  timeoutMs: number,
): void {
  request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
}

function performNodeProxyRequest(options: {
  requestModule: NodeRequestModule;
  requestOptions: RequestOptions;
  bodyBuffer?: Buffer;
  requestLogger: AppLogger;
  timeoutMs: number;
  onResponse: (response: IncomingMessage) => Response;
  errorMessage: string;
}): Promise<Response> {
  const {
    requestModule,
    requestOptions,
    bodyBuffer,
    requestLogger,
    timeoutMs,
    onResponse,
    errorMessage,
  } = options;

  return new Promise<Response>((resolve, reject) => {
    const upstreamRequest = requestModule.request(requestOptions, (upstreamResponse) => {
      resolve(onResponse(upstreamResponse));
    });

    upstreamRequest.setTimeout(timeoutMs, () => {
      requestLogger.error({ timeoutMs }, `${errorMessage} timed out`);
      destroyRequestWithError(upstreamRequest, timeoutMs);
    });

    upstreamRequest.on('error', (error: Error) => {
      requestLogger.error({ message: error.message }, errorMessage);
      reject(error);
    });

    if (bodyBuffer && bodyBuffer.length > 0) {
      upstreamRequest.write(bodyBuffer);
    }

    upstreamRequest.end();
  });
}

async function proxyMcpRequest(
  request: Request,
  nodeRequest: IncomingMessage,
  rootLogger: AppLogger,
  config: AppConfig,
  httpsModule: NodeRequestModule,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const facadeUrls = buildFacadeUrls(request);
  const requestLogger = createLogger(rootLogger, {
    component: 'mcp-proxy',
    method: request.method,
    path: `${requestUrl.pathname}${requestUrl.search}`,
  });
  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer());

  return performNodeProxyRequest({
    requestModule: httpsModule,
    requestOptions: {
      protocol: 'https:',
      hostname: 'mcp.slack.com',
      port: 443,
      method: request.method,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      headers: createMcpUpstreamHeaders(nodeRequest),
    },
    bodyBuffer,
    requestLogger,
    timeoutMs: config.requestTimeoutMs,
    errorMessage: 'Slack MCP proxy failed',
    onResponse: (upstreamResponse) => {
      const responseHeaders: OutgoingHttpHeaders = {
        ...upstreamResponse.headers,
      };

      const rewrittenAuthenticateHeader = rewriteWwwAuthenticateHeader(
        upstreamResponse.headers['www-authenticate'],
        facadeUrls.protectedResource,
      );

      if (rewrittenAuthenticateHeader !== undefined) {
        responseHeaders['www-authenticate'] = rewrittenAuthenticateHeader;
      }

      requestLogger.info(
        {
          status: upstreamResponse.statusCode,
          wwwAuthenticate: rewrittenAuthenticateHeader,
        },
        'Proxying MCP response',
      );

      return new Response(upstreamResponse as unknown as ReadableStream<Uint8Array>, {
        status: upstreamResponse.statusCode || 502,
        headers: toHeaders(responseHeaders),
      });
    },
  });
}

async function proxyCallbackRequest(
  request: Request,
  nodeRequest: IncomingMessage,
  config: AppConfig,
  rootLogger: AppLogger,
  httpModule: NodeRequestModule,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const requestLogger = createLogger(rootLogger, {
    component: 'callback',
    method: request.method,
    path: requestUrl.pathname,
  });
  const targetUrl = new URL(
    `http://${config.opencodeHost}:${config.opencodePort}${config.opencodeCallbackPath}`,
  );

  targetUrl.search = requestUrl.search;

  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  const bodyText = bodyBuffer.toString('utf8');

  requestLogger.info(
    {
      incoming: requestUrl.toString(),
      requestHeaders: sanitizeHeaders(Object.fromEntries(request.headers.entries())),
      requestBody: sanitizeText(bodyText),
      upstream: targetUrl.toString(),
    },
    'Forwarding OAuth callback to opencode',
  );

  try {
    return await performNodeProxyRequest({
      requestModule: httpModule,
      requestOptions: {
        hostname: config.opencodeHost,
        port: config.opencodePort,
        path: `${config.opencodeCallbackPath}${requestUrl.search}`,
        method: request.method,
        headers: {
          ...copyNodeHeaders(nodeRequest.headers),
          host: `${config.opencodeHost}:${config.opencodePort}`,
          connection: 'close',
        },
      },
      bodyBuffer,
      requestLogger,
      timeoutMs: config.requestTimeoutMs,
      errorMessage: 'Opencode callback proxy failed',
      onResponse: (proxyResponse) => {
        requestLogger.info(
          {
            status: proxyResponse.statusCode,
            headers: sanitizeHeaders(proxyResponse.headers),
          },
          'Opencode callback response',
        );

        return new Response(proxyResponse as unknown as ReadableStream<Uint8Array>, {
          status: proxyResponse.statusCode || 502,
          headers: toHeaders(copyNodeHeaders(proxyResponse.headers)),
        });
      },
    });
  } catch {
    return new Response(CALLBACK_PROXY_ERROR_RESPONSE, { status: 502 });
  }
}

type CreateAppOptions = {
  config: AppConfig;
  rootLogger: AppLogger;
  dependencies?: Partial<AppDependencies>;
};

export function createApp({ config, rootLogger, dependencies }: CreateAppOptions): Hono<NodeEnv> {
  const app = new Hono<NodeEnv>();
  const discoveryLogger = createLogger(rootLogger, { component: 'oauth-discovery' });
  const authorizeLogger = createLogger(rootLogger, { component: 'authorize' });
  const tokenLogger = createLogger(rootLogger, { component: 'token' });
  const appErrorLogger = createLogger(rootLogger, { component: 'app-error' });
  const fetcher = dependencies?.fetcher ?? fetch;
  const jsonFetcher = dependencies?.jsonFetcher ?? fetch;
  const httpModule = dependencies?.httpModule ?? {
    request: (options, callback) => http.request(options, callback),
  };
  const httpsModule = dependencies?.httpsModule ?? {
    request: (options, callback) => https.request(options, callback),
  };

  app.get('/.well-known/oauth-protected-resource', async (c) => {
    const slackMetadata = await fetchProtectedResourceMetadata(
      config.requestTimeoutMs,
      jsonFetcher,
    );
    const facadeUrls = buildFacadeUrls(c.req.raw);
    const payload = {
      ...slackMetadata,
      resource: facadeUrls.mcp,
      authorization_servers: [facadeUrls.origin],
    };

    discoveryLogger.info(payload, 'Serving OAuth protected resource metadata');
    return c.json(payload, 200);
  });

  app.get('/.well-known/oauth-authorization-server', async (c) => {
    const slackMetadata = await fetchAuthorizationServerMetadata(
      config.requestTimeoutMs,
      jsonFetcher,
    );
    const facadeUrls = buildFacadeUrls(c.req.raw);
    const payload = {
      ...slackMetadata,
      issuer: facadeUrls.origin,
      authorization_endpoint: facadeUrls.authorize,
      token_endpoint: facadeUrls.token,
    };

    discoveryLogger.info(payload, 'Serving OAuth authorization server metadata');
    return c.json(payload, 200);
  });

  app.get('/oauth/authorize', (c) => {
    const requestUrl = new URL(c.req.url);
    const { upstreamUrl, originalRedirectUri } = buildSlackAuthorizeUrl(
      requestUrl,
      config.targetRedirectUri,
    );
    const clientId = upstreamUrl.searchParams.get('client_id');

    authorizeLogger.info(
      {
        incoming: requestUrl.toString(),
        upstream: upstreamUrl.toString(),
        clientId,
        rewrittenRedirectUri: {
          from: originalRedirectUri,
          to: config.targetRedirectUri,
        },
      },
      'Forwarding authorize request',
    );

    return c.redirect(upstreamUrl.toString(), 302);
  });

  app.post('/oauth/token', async (c) => {
    const requestUrl = new URL(c.req.url);
    const bodyText = await c.req.text();
    const params = parseTokenRequestParams(
      c.req.header('content-type') || '',
      requestUrl,
      bodyText,
    );
    const originalRedirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');

    params.set('redirect_uri', config.targetRedirectUri);

    tokenLogger.info(
      {
        incoming: requestUrl.toString(),
        requestHeaders: sanitizeHeaders(Object.fromEntries(c.req.raw.headers.entries())),
        requestBody: sanitize(Object.fromEntries(params.entries())),
        clientId,
        rewrittenRedirectUri: {
          from: originalRedirectUri,
          to: config.targetRedirectUri,
        },
        upstream: SLACK_TOKEN_URL,
      },
      'Forwarding token request',
    );

    const { signal, cleanup } = withTimeoutSignal(config.requestTimeoutMs);

    let upstreamResponse: Response;

    try {
      upstreamResponse = await fetcher(SLACK_TOKEN_URL, {
        method: 'POST',
        headers: {
          accept: c.req.header('accept') || 'application/json',
          'accept-encoding': 'identity',
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          'user-agent': c.req.header('user-agent') || 'opencode-slack-mcp-proxy/1.0',
        },
        body: params.toString(),
        signal,
      });
    } catch (error) {
      cleanup();

      tokenLogger.error(
        {
          message: error instanceof Error ? error.message : String(error),
        },
        'Slack token request failed',
      );

      throw new Error('Unable to reach Slack token endpoint');
    }

    cleanup();

    const upstreamBody = await upstreamResponse.text();

    tokenLogger.info(
      {
        status: upstreamResponse.status,
        headers: sanitizeHeaders(filterFetchResponseHeaders(upstreamResponse.headers)),
        body: sanitizeText(upstreamBody),
      },
      'Slack token response',
    );

    return new Response(upstreamBody, {
      status: upstreamResponse.status,
      headers: filterFetchResponseHeaders(upstreamResponse.headers),
    });
  });

  app.all('/callback', (c) =>
    proxyCallbackRequest(c.req.raw, c.env.incoming, config, rootLogger, httpModule),
  );
  app.all('/mcp', (c) =>
    proxyMcpRequest(c.req.raw, c.env.incoming, rootLogger, config, httpsModule),
  );
  app.all('/mcp/*', (c) =>
    proxyMcpRequest(c.req.raw, c.env.incoming, rootLogger, config, httpsModule),
  );

  app.notFound((c) => c.text('Not found\n', 404));

  app.onError((error, c) => {
    appErrorLogger.error(
      {
        path: new URL(c.req.url).pathname,
        message: error.message,
      },
      'App request failed',
    );

    return c.text(DEFAULT_ERROR_RESPONSE, 502);
  });

  return app;
}
