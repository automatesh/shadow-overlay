# Local Proxy Runtime

This folder contains a local runtime bundle for the proxy used by overlay:

- `cli-proxy-api.exe` (Windows binary)
- `config.yaml` (local config used by `start-proxy.bat`)
- `config.example.yaml` (full upstream example)

## Start

1. Edit `config.yaml`:
   - set `api-keys[0]` to your local proxy key
2. In `../.env`, set:
   - `CLAUDE_CODE_SETUP_TOKEN` to the same key
   - optionally `CLAUDE_PROXY_BASE_URL` (default `http://127.0.0.1:8317`)
3. Start overlay using `../start.bat` (it auto-starts proxy if needed),
   or run proxy manually via `start-proxy.bat`.

## Upstream project

This proxy runtime is based on CLIProxyAPI:

- GitHub: `https://github.com/router-for-me/CLIProxyAPI`

Do not commit real auth artifacts:

- `auth/`
- runtime logs
