import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

import { sanitize } from './sanitize.js';

export function sanitizeHeaders(headers: IncomingHttpHeaders | Record<string, unknown>): unknown {
  return sanitize(headers);
}

export function filterFetchResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey === 'connection' ||
      lowerKey === 'content-length' ||
      lowerKey === 'transfer-encoding' ||
      lowerKey === 'content-encoding'
    ) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function copyNodeHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function toHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders): Headers {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        result.append(key, entry);
      }

      continue;
    }

    result.set(key, String(value));
  }

  return result;
}
