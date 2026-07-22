# Dagent

Dagent is the Windows desktop version of the `sagent` proof of concept. It uses React 19 for the UI and Tauri 2/Rust for local persistence, provider requests, tools, skills, sessions, and subagent events.

## Features

- Session history persisted locally and shown in the sidebar.
- OpenAI-compatible and Anthropic-compatible provider formats.
- Local `config.toml` with API key, base URL, model, theme, context limit, and effort level.
- Editable `SKILL.md` files with per-session enable/disable controls.
- Visible tool/skill invocation, token usage, context meter, and subagent status.
- Slash operations: `/effort low|medium|high`, `/clear`, `/compact`, `/usage`, `/new`, `/skills`, and `/settings`.
- Built-in calculator, current-time, skill-loading, and subagent tools.

Local data is stored under Tauri's app configuration directory (`io.dagent.desktop`). The API key is local to the device and is not committed to the repository.

## Windows release

The app is intentionally built on GitHub Actions rather than in this environment. Push a tag such as `v0.1.0`, or run **Dagent Windows Release** manually and supply a tag. The workflow creates a GitHub Release and uploads the NSIS `.exe` installer to its release assets.

## Development

```bash
cd dagent
npm install
npm run tauri dev
```

The GitHub workflow installs dependencies from `package.json` on its Windows runner.
