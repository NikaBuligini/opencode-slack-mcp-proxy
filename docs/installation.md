# Installation

Prerequisites:

- `pnpm`

Clone the repo and install dependencies:

```bash
git clone <your-repo-url>
cd opencode-slack-mcp-proxy
pnpm install
```

## Run

Start the server in the foreground:

```bash
pnpm start
```

The app runs as one Hono application with two listeners:

- facade: `http://127.0.0.1:3120/mcp`
- callback bridge: `http://localhost:3118/callback`

This server must be running before you use Slack MCP in opencode.

## Run In Background

### macOS or Linux - quick option

```bash
nohup pnpm start > opencode-slack-mcp-proxy.log 2>&1 & echo $! > opencode-slack-mcp-proxy.pid
```

Stop it later with:

```bash
kill "$(cat opencode-slack-mcp-proxy.pid)" && rm -f opencode-slack-mcp-proxy.pid
```

This is safer than killing by command name because it only stops the specific background process you started for this project.

If the process is stuck, a port-based fallback is:

```bash
kill "$(lsof -t -i:3120)"
```

Use `-9` only as a last resort.

### macOS - LaunchAgent

For a persistent background process that restarts automatically, create `~/Library/LaunchAgents/com.opencode-slack-mcp-proxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.opencode-slack-mcp-proxy</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>cd /absolute/path/to/opencode-slack-mcp-proxy && pnpm start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/opencode-slack-mcp-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/opencode-slack-mcp-proxy.log</string>
  </dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.opencode-slack-mcp-proxy.plist
```

Unload it:

```bash
launchctl unload ~/Library/LaunchAgents/com.opencode-slack-mcp-proxy.plist
```

### Linux - user systemd service

Create `~/.config/systemd/user/opencode-slack-mcp-proxy.service`:

```ini
[Unit]
Description=opencode Slack MCP proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/opencode-slack-mcp-proxy
ExecStart=/usr/bin/env pnpm start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

Enable and start it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now opencode-slack-mcp-proxy
```

Check logs:

```bash
journalctl --user -u opencode-slack-mcp-proxy -f
```

### Windows - PowerShell background process

```powershell
Start-Process -WindowStyle Hidden -FilePath pnpm -ArgumentList 'start'
```

For persistent startup on login, use Windows Task Scheduler and run `pnpm start` in the project directory.

## Docker

Docker is an optional way to package and run the facade in the background.

Build the image:

```bash
docker build -t opencode-slack-mcp-proxy .
```

Run it in detached mode:

```bash
docker run -d \
  --name opencode-slack-mcp-proxy \
  -p 127.0.0.1:3120:3120 \
  -p 127.0.0.1:3118:3118 \
  -e OPENCODE_HOST=host.docker.internal \
  opencode-slack-mcp-proxy
```

View logs:

```bash
docker logs -f opencode-slack-mcp-proxy
```

Stop and remove it:

```bash
docker rm -f opencode-slack-mcp-proxy
```

Notes:

- The container listens on `0.0.0.0` internally, but the example publishes only to `127.0.0.1` on the host.
- On macOS and Windows, `host.docker.internal` is the simplest way for the container to reach opencode on the host machine.
- On Linux, host access may require a different hostname or Docker networking setup.

## Verify

Once the server is running, check the OAuth discovery endpoint:

```bash
curl http://127.0.0.1:3120/.well-known/oauth-protected-resource
```

If that returns JSON, the facade is up.

## Recommended Setup Order

1. clone this repo and run `pnpm install`
2. start this server in the background
3. verify `http://127.0.0.1:3120/.well-known/oauth-protected-resource`
4. add the opencode config pointing Slack MCP to `http://127.0.0.1:3120/mcp`
5. enable Slack MCP in opencode and complete the browser OAuth flow

## Troubleshooting

- If `3120` is already in use, set `FACADE_PORT` before starting the server.
- If `3118` is already in use, set `CALLBACK_PORT` before starting the server.
- If OAuth completes in the browser but opencode does not receive it, make sure opencode is listening on `127.0.0.1:19876` or adjust `OPENCODE_HOST`, `OPENCODE_PORT`, and `OPENCODE_CALLBACK_PATH`.
- Keep the facade on loopback-only hosts; this project is meant for local use.
