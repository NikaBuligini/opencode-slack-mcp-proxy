import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { test } from 'vitest';

import { createApp, parseTokenRequestParams } from './app.js';
import { parseConfig } from './config.js';
import { createRootLogger } from './logger.js';

class MockIncomingMessage extends PassThrough {
  statusCode?: number;
  headers: Record<string, string | string[]>;

  constructor(statusCode = 200, headers: Record<string, string | string[]> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

class MockClientRequest extends EventEmitter {
  body = '';
  timeoutMs?: number;

  setTimeout(timeoutMs: number, callback: () => void): this {
    this.timeoutMs = timeoutMs;
    this.once('timeout', callback);
    return this;
  }

  write(chunk: Buffer | string): void {
    this.body += chunk.toString();
  }

  end(): void {}

  destroy(error?: Error): void {
    this.emit('error', error ?? new Error('destroyed'));
  }
}

function createConfig(overrides: Record<string, string | undefined> = {}) {
  return parseConfig({
    FACADE_HOST: '127.0.0.1',
    CALLBACK_HOST: '127.0.0.1',
    OPENCODE_HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    REQUEST_TIMEOUT_MS: '25',
    ...overrides,
  });
}

function createNodeRequest(headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
  } as IncomingMessage;
}

test('parseTokenRequestParams supports JSON payloads', () => {
  const params = parseTokenRequestParams(
    'application/json; charset=utf-8',
    new URL('http://127.0.0.1/oauth/token'),
    JSON.stringify({ grant_type: 'authorization_code', code: 'abc', extra: 1 }),
  );

  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('code'), 'abc');
  assert.equal(params.get('extra'), '1');
});

test('authorize rewrites redirect_uri to callback bridge', async () => {
  const app = createApp({
    config: createConfig({ CALLBACK_PORT: '3118' }),
    rootLogger: createRootLogger('silent'),
  });

  const response = await app.request(
    'http://127.0.0.1:3120/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:9999/callback&scope=users.profile:read',
    { redirect: 'manual' },
  );

  assert.equal(response.status, 302);

  const location = response.headers.get('location');

  assert.ok(location);

  const upstream = new URL(location);

  assert.equal(upstream.origin, 'https://slack.com');
  assert.equal(upstream.pathname, '/oauth/v2_user/authorize');
  assert.equal(upstream.searchParams.get('client_id'), 'test-client');
  assert.equal(upstream.searchParams.get('redirect_uri'), 'http://localhost:3118/callback');
});

test('token endpoint rewrites redirect_uri before forwarding', async () => {
  let requestInit: RequestInit | undefined;

  const app = createApp({
    config: createConfig({ CALLBACK_PORT: '4222' }),
    rootLogger: createRootLogger('silent'),
    dependencies: {
      fetcher: async (_url, init) => {
        requestInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  });

  const response = await app.request('http://127.0.0.1:3120/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: 'test-client',
      code: 'secret-code',
      redirect_uri: 'http://localhost:9999/old',
    }),
  });

  assert.equal(response.status, 200);
  assert.ok(requestInit);

  const body = String(requestInit.body);
  const params = new URLSearchParams(body);

  assert.equal(params.get('client_id'), 'test-client');
  assert.equal(params.get('redirect_uri'), 'http://localhost:4222/callback');
});

test('callback proxy returns generic 502 on upstream failure', async () => {
  const app = createApp({
    config: createConfig(),
    rootLogger: createRootLogger('silent'),
    dependencies: {
      httpModule: {
        request: (_options, _callback) => {
          const request = new MockClientRequest();
          queueMicrotask(() => {
            request.emit('error', new Error('connection refused'));
          });
          return request as never;
        },
      },
    },
  });

  const response = await app.request(
    'http://127.0.0.1:3118/callback?code=abc',
    {
      method: 'GET',
    },
    { incoming: createNodeRequest() },
  );

  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'Callback proxy request failed\n');
});

test('mcp proxy rewrites WWW-Authenticate resource metadata', async () => {
  const app = createApp({
    config: createConfig(),
    rootLogger: createRootLogger('silent'),
    dependencies: {
      httpsModule: {
        request: (_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
          const request = new MockClientRequest();
          queueMicrotask(() => {
            const response = new MockIncomingMessage(401, {
              'www-authenticate':
                'Bearer resource_metadata="https://mcp.slack.com/.well-known/oauth-protected-resource"',
            });
            response.end();
            callback(response as unknown as IncomingMessage);
          });
          return request as never;
        },
      },
    },
  });

  const response = await app.request(
    'http://127.0.0.1:3120/mcp',
    {
      method: 'GET',
    },
    { incoming: createNodeRequest() },
  );

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    'Bearer resource_metadata="http://127.0.0.1:3120/.well-known/oauth-protected-resource"',
  );
});

test('parseConfig allows container listener hosts and host.docker.internal upstream host', () => {
  const config = parseConfig({
    FACADE_HOST: '0.0.0.0',
    CALLBACK_HOST: '0.0.0.0',
    OPENCODE_HOST: 'host.docker.internal',
  });

  assert.equal(config.facadeHost, '0.0.0.0');
  assert.equal(config.callbackHost, '0.0.0.0');
  assert.equal(config.opencodeHost, 'host.docker.internal');
});
