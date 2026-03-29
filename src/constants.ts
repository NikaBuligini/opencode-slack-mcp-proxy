export const SLACK_MCP_ORIGIN = 'https://mcp.slack.com';
export const SLACK_MCP_URL = `${SLACK_MCP_ORIGIN}/mcp`;
export const SLACK_PROTECTED_RESOURCE_URL = `${SLACK_MCP_ORIGIN}/.well-known/oauth-protected-resource`;
export const SLACK_AUTHORIZATION_SERVER_URL = `${SLACK_MCP_ORIGIN}/.well-known/oauth-authorization-server`;
export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2_user/authorize';
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.user.access';

export const REDACTED = '[redacted]';

export const REDACTED_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'authorization',
  'cookie',
  'set-cookie',
  'code',
]);
