# opencode-slack-mcp-proxy

Local TypeScript + Hono facade for Slack MCP that only intercepts the Slack OAuth-specific surfaces it must rewrite, while proxying MCP traffic to Slack and preserving the incoming Slack `clientId` from opencode requests.

## Motivation

Slack MCP is designed to work with Claude Code's OAuth flow. opencode uses a fixed local callback port for OAuth, and Slack MCP does not authenticate correctly against that flow out of the box.

Because of that mismatch, Slack MCP authentication fails in opencode unless the OAuth endpoints and callback flow are adapted. This project acts as a small local proxy that rewrites only the Slack OAuth-specific pieces, keeps the rest of the MCP traffic pointed at Slack, and makes Slack MCP usable from opencode.

## Installation

See [`docs/installation.md`](docs/installation.md) for setup, background-run instructions, Docker usage, verification, and troubleshooting.

Useful commands:

```bash
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm check
pnpm test
pnpm test:all
```

Source lives in `src/`, and the main route implementation is in `src/app.ts`.

For production-style runs, the app can also be compiled to `build/` and started with `pnpm start`.

Optional environment variables:

- `FACADE_HOST` - facade host, default `127.0.0.1`
- `FACADE_PORT` or `PORT` - facade port, default `3120`
- `CALLBACK_HOST` - callback listener host, default `127.0.0.1`
- `CALLBACK_PORT` - callback port, default `3118`
- `LOG_LEVEL` - pino log level, default `info`
- `OPENCODE_HOST` - opencode callback host, default `127.0.0.1`
- `OPENCODE_PORT` - opencode callback port, default `19876`
- `OPENCODE_CALLBACK_PATH` - opencode callback path, default `/mcp/oauth/callback`
- `REQUEST_TIMEOUT_MS` - timeout for Slack and local proxy requests, default `10000`

All listener hosts are restricted to loopback values (`127.0.0.1` or `localhost`) to avoid exposing the callback bridge on external interfaces.

For containerized runs, listener hosts may also use `0.0.0.0`, and `OPENCODE_HOST` may be set to a reachable host such as `host.docker.internal`.

## opencode config

Use this in place of the remote Slack MCP URL after the local facade is already running:

```json
{
  "slack": {
    "type": "remote",
    "url": "http://127.0.0.1:3120/mcp",
    "oauth": {
      "clientId": "YOUR_SLACK_CLIENT_ID"
    }
  }
}
```

## Flow

1. opencode connects to the local MCP facade at `http://127.0.0.1:3120/mcp`
2. the facade serves local OAuth discovery metadata
3. opencode uses the facade's local authorize and token endpoints
4. the authorize endpoint redirects to Slack with `redirect_uri=http://localhost:3118/callback`
5. the callback bridge forwards Slack's callback to `http://127.0.0.1:19876/mcp/oauth/callback`
6. the token endpoint forwards to Slack and forces the same `redirect_uri=http://localhost:3118/callback`

## Logs

The server logs:

- OAuth discovery responses
- authorize forwarding and rewritten `redirect_uri`
- token forwarding and rewritten `redirect_uri`
- Slack token response status and sanitized body
- callback forwarding to opencode

## Tests

The unit tests cover the highest-risk rewrite paths:

- authorize redirect rewriting
- token redirect rewriting
- callback proxy failure handling
- `WWW-Authenticate` resource metadata rewriting

Use `pnpm test` for unit tests and `pnpm test:all` to run both static checks and tests together.
