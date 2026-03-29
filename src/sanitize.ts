import { REDACTED, REDACTED_KEYS } from './constants.js';

function maskValue(key: string | undefined, value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (key && REDACTED_KEYS.has(key.toLowerCase())) {
    return REDACTED;
  }

  return value;
}

export function sanitize(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, parentKey));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(maskValue(key, entry), key)]),
    );
  }

  return maskValue(parentKey, value);
}

export function sanitizeText(text: string): unknown {
  if (!text) {
    return text;
  }

  try {
    return sanitize(JSON.parse(text));
  } catch {
    return text
      .replace(/("access_token"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
      .replace(/("refresh_token"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
      .replace(/("id_token"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
      .replace(/("client_secret"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
      .replace(/("code"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`)
      .replace(/(access_token=)[^&\s]+/gi, `$1${REDACTED}`)
      .replace(/(refresh_token=)[^&\s]+/gi, `$1${REDACTED}`)
      .replace(/(id_token=)[^&\s]+/gi, `$1${REDACTED}`)
      .replace(/(client_secret=)[^&\s]+/gi, `$1${REDACTED}`)
      .replace(/(code=)[^&\s]+/gi, `$1${REDACTED}`);
  }
}
