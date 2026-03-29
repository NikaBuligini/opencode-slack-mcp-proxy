import {
  SLACK_AUTHORIZATION_SERVER_URL,
  SLACK_AUTHORIZE_URL,
  SLACK_PROTECTED_RESOURCE_URL,
} from './constants.js';
import { sanitizeText } from './sanitize.js';

export type JsonFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchSlackJson(
  url: string,
  timeoutMs: number,
  fetcher: JsonFetcher = fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  timeout.unref?.();

  let response: Response;

  try {
    response = await fetcher(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'opencode-slack-mcp-proxy/1.0',
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error) {
      throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }

    throw new Error(`Failed to fetch ${url}`);
  }

  clearTimeout(timeout);

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from ${url}: ${String(sanitizeText(bodyText))}`);
  }

  return JSON.parse(bodyText) as Record<string, unknown>;
}

export async function fetchProtectedResourceMetadata(
  timeoutMs: number,
  fetcher?: JsonFetcher,
): Promise<Record<string, unknown>> {
  return fetchSlackJson(SLACK_PROTECTED_RESOURCE_URL, timeoutMs, fetcher);
}

export async function fetchAuthorizationServerMetadata(
  timeoutMs: number,
  fetcher?: JsonFetcher,
): Promise<Record<string, unknown>> {
  return fetchSlackJson(SLACK_AUTHORIZATION_SERVER_URL, timeoutMs, fetcher);
}

export function buildSlackAuthorizeUrl(
  inputUrl: URL,
  targetRedirectUri: string,
): { upstreamUrl: URL; originalRedirectUri: string | null } {
  const upstreamUrl = new URL(SLACK_AUTHORIZE_URL);

  for (const [key, value] of inputUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(key, value);
  }

  const originalRedirectUri = upstreamUrl.searchParams.get('redirect_uri');
  upstreamUrl.searchParams.set('redirect_uri', targetRedirectUri);

  return { upstreamUrl, originalRedirectUri };
}
