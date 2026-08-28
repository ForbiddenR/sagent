# SAgent

A small agent server built with [Bun](https://bun.sh) and
[LangGraph](https://langchain-ai.github.io/langgraphjs/), backed by Claude. It
demonstrates a few things in a minimal, readable way:

- **Skills** — Claude Code–style. Each skill is a folder under `skills/` with a
  `SKILL.md`. The agent sees a one-line index of every skill and loads a skill's
  full instructions *on demand* via the `load_skill` tool (progressive disclosure).
  A **skill market** lets you add third-party sources (`owner/repo`, a git URL,
  or a `marketplace.json` URL) and install skills from them.
- **Subagents** — OpenCode / Claude Code / Codex-style. The parent calls `task`
  to spawn a specialized worker (`general`, `explore`, or a custom
  `agents/<name>/AGENT.md`) with a fresh context. Independent `task` calls in
  one turn run in parallel; only the subagent's final answer returns to the parent.
- **Plan mode** — OpenCode-style primary mode. Toggle Plan / Build on the input
  bar, or let the agent call `switch_mode`. Plan is read-only (`write_file` and
  `run_bash` off; `task` may only spawn read-only workers like `explore`).
  Switch to Build to implement the plan. The conversation stays in the same session.
- **Thinking level** — Claude adaptive thinking (`output_config.effort`). Toggle
  Low / Med / High / xHigh / Max on the input bar. Higher effort thinks more
  before answering (slower, better on hard tasks). Default is High. The model's
  thinking stream shows as a collapsible **Thought** block above the reply.
- **Memory** — conversation history per session id, **persisted to `.sessions.json`**
  so sessions survive server restarts. The first prompt mints a short **session title**
  in the background (Haiku-class, no tools); double-click a row to rename it.
- **Agent loop** — a LangGraph `StateGraph` (`model` → `tools` → `model` …) with
  streaming tokens, a tool-round cap, and an abort-on-stall timeout that notifies
  the user when the API is unresponsive.
- **Tools** — `calculator`, `current_time`, `read_file`, `write_file`, `run_bash`
  (with human-in-the-loop approval), `search_workspace` (semantic, RAG-backed),
  `web_search_exa` / `web_fetch_exa` (Exa web search and page fetch),
  `load_skill`, `task`, and `switch_mode` (Plan ↔ Build).
- **Workspace** — each session gets a private folder for files. Open **Files**
  for a small window with the folder tree; click a file to preview and edit it.

A single-page chat UI (**React 19**, bundled natively by Bun — no Vite/webpack)
streams responses over Server-Sent Events. Styling is Tailwind via CDN with
shadcn-style components. The page includes a sidebar where you can create,
choose, reset, and delete sessions, plus inspect and enable/disable skills per
session, and a file browser/editor for the session workspace.

## Stack

| Concern   | Choice |
|-----------|--------|
| Runtime   | Bun (runs TypeScript directly — no build step) |
| LLM       | Claude via `@langchain/anthropic` (`claude-opus-4-8` by default) |
| Agent     | `@langchain/langgraph` `StateGraph` (model/tools nodes, conditional routing) |
| Tools     | `@langchain/core` `tool()` + zod schemas; `expr-eval` for safe math; hosted Exa MCP for web search/fetch (no API key required) |
| Retrieval | `@langchain/textsplitters` + in-memory vector store (`search_workspace`) |
| Frontend  | React 19, bundled by Bun's native HTML import (HMR in dev); Tailwind via CDN |

## Setup

```bash
bun install
cp .env.example .env          # then set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
```

Get an API key at https://console.anthropic.com/. Bun auto-loads `.env`.

## Run

```bash
bun run dev      # hot reload (http://localhost:3000)
# or
bun run start
```

Open http://localhost:3000.

## Try it

- **Tool calling**: “What is 1234 × 9?” → a `calculator` chip appears, answer streams back.
- **Skills**: inspect `calculator` or `poetry` in the sidebar, toggle them on/off per
  session, then ask “Write me a haiku about the sea.” → when `poetry` is enabled,
  a `load_skill` chip appears and the reply follows the skill's rules.
- **Skill market**: on the Skills tab, open **Market**, add `anthropics/skills`
  (or any git / `marketplace.json` URL), then Install a listed skill. It lands in
  `skills/` and is enabled for every session.
- **Files & bash**: ask the agent to create or read a file in its workspace, or to run
  a shell command → `run_bash` requests approval first via an inline card; approve to
  run it. Open **Files** in the header to browse the workspace tree and edit a file.
- **Semantic search**: with files in the workspace, ask something like “search the
  workspace for notes about caching” → `search_workspace` finds relevant chunks.
- **Sessions**: use the sidebar to create, choose, reset, and delete independent
  sessions. Each session has its own memory and enabled-skill set. The first
  prompt auto-titles the row (e.g. “Auth refresh token support”); double-click
  to rename — a manual name is never overwritten.
- **Memory**: ask a follow-up like “what did I just ask?” → prior turns in the
  selected session are remembered.
- **Subagents**: ask “use explore to search the web for LangGraph 1.x, then
  summarize” → a `task` chip / subagent card appears; the parent only sees the
  subagent’s final report, not its intermediate tool calls.
- **Plan mode**: toggle **Plan** on the input bar (or ask “plan how to add a notes
  file”) → the agent may call `switch_mode`. The reply is a numbered plan; writes
  stay blocked until you (or the agent, after you accept) switch to **Build**.
- **Thinking**: set Low / Med / High / xHigh / Max on the input bar. High is the
  default; Max spends the most time reasoning. A **Thought** block streams above
  the answer so you can tell thinking apart from the reply.
- **Timeouts**: if the model stops responding, the request is aborted after
  `MODEL_TIMEOUT_MS` and a “⏱ Request timed out — check the API” notice appears.
- Restart the server → sessions and history are restored from `.sessions.json`.

## Project layout

```
src/
  index.ts           Bun.serve — routes: "/" (HTML), /api/chat, /api/sessions,
                     /api/skills, /api/marketplaces, /api/subagents, /api/approvals, session mode/thinking, files & upload endpoints
  agent.ts           LangGraph StateGraph (model/tools nodes) + streaming + timeout
  memory.ts          SessionStore — sessions, enabled skills, messages (persisted)
  title.ts           cheap Haiku title from the first user prompt
  rag.ts             in-memory vector store backing search_workspace
  skills.ts          load SKILL.md folders (Bun.Glob), build the skill index
  marketplace.ts     third-party skill sources (GitHub / git / marketplace.json)
  tools.ts           calculator, current_time, read_file, write_file, run_bash,
                     search_workspace, web_search_exa, web_fetch_exa, load_skill, task, switch_mode
  subagents.ts       load AGENT.md folders, built-in general / explore catalog
  exa.ts             hosted Exa MCP client for web_search_exa / web_fetch_exa
  frontend/
    index.html       HTML entry — imports app.tsx (Bun bundles it natively)
    app.tsx          React 19 chat UI (streams SSE; approval cards, file editor)
skills/
  calculator/SKILL.md
  poetry/SKILL.md
agents/
  general/AGENT.md
  explore/AGENT.md
```

## Adding a skill

Create `skills/<name>/SKILL.md` with frontmatter and instructions:

```markdown
---
name: my-skill
description: One line shown to the model so it knows when to load this.
---

# My skill

Detailed instructions the agent reads after calling load_skill("my-skill").
```

Restart the server — it's picked up automatically.

## Skill market

Open **Market** from the Skills tab and paste a source address:

| Address | Example |
|---------|---------|
| GitHub `owner/repo` | `anthropics/skills` |
| GitHub URL | `https://github.com/anthropics/skills` |
| Git URL | `https://gitlab.com/org/skills.git` |
| Catalog JSON | `https://example.com/marketplace.json` |
| Local path | `./my-marketplace` |

SAgent reads Claude Code `marketplace.json` catalogs when present, otherwise it
scans the repo for `**/SKILL.md`. Install copies the skill folder into
`skills/<name>/` (with an `origin` stamp) and enables it for every session.
Sources are stored in `.marketplaces.json`.

## Adding a subagent

Create `agents/<name>/AGENT.md` with frontmatter and a system prompt:

```markdown
---
name: reviewer
description: Reviews code for bugs and missing tests. Use after a general subagent writes files.
tools: read_file, search_workspace, calculator, current_time, load_skill
---

You are a code-review subagent.

Read the files the parent names in the prompt. Report bugs, missing tests, and residual risks. Do not modify files.
```

`name` is the `subagent_type` the parent passes to `task`. `tools` is an optional
comma-separated allowlist; omit it to inherit every parent tool except `task`
(subagents cannot nest). Restart the server — it's picked up automatically.

Built-in types (`general`, `explore`) also live in `agents/`; edit those files to
override the defaults.

## Configuration

All options are read from the environment (Bun auto-loads `.env`). See `.env.example`.

| Env var               | Default              | Notes |
|-----------------------|----------------------|-------|
| `ANTHROPIC_API_KEY`   | —                    | Console API key from https://console.anthropic.com/. Required unless `ANTHROPIC_AUTH_TOKEN` is set. |
| `ANTHROPIC_AUTH_TOKEN`| —                    | Bearer token (Claude Code / OAuth / some gateways). Used if `ANTHROPIC_API_KEY` is unset. |
| `MODEL`               | `claude-opus-4-8`    | Any Claude model id (e.g. `claude-haiku-4-5` for cheaper/faster). |
| `TITLE_MODEL`         | `claude-haiku-4-5`   | Cheap model used only to generate a session title from the first prompt. No tools, no thinking. |
| `TITLE_TIMEOUT_MS`    | `8000`               | Max ms to wait for a title; falls back to a truncated first message. |
| `ANTHROPIC_BASE_URL`  | Anthropic API        | Optional. Point at an Anthropic-compatible endpoint (gateway/proxy, e.g. LiteLLM, Cloudflare AI Gateway, a corporate proxy). Must speak the Anthropic `/v1/messages` API. Leave unset for the default. |
| `EXA_API_KEY`         | —                    | Optional. Higher rate limits for `web_search_exa` / `web_fetch_exa`. Without it, tools use Exa's hosted MCP at https://mcp.exa.ai/mcp (free, rate-limited). |
| `MODEL_TIMEOUT_MS`    | `60000`              | Max ms to wait for the next model chunk before treating the request as timed out (a streaming response is not interrupted; only total silence trips it). Emits a timeout notification so the user knows to check the API. |
| `MAX_MODEL_MESSAGES`  | `100`                | Max recent messages sent back to the model for context. Full frontend session messages are still persisted separately. |
| `SESSION_STORE_FILE`  | `.sessions.json`     | Where persisted sessions are stored. |
| `WORKSPACE`           | `./workspace`        | Workspace folder for the `read_file` / `write_file` tools. |
| `GITHUB_TOKEN`        | —                    | Optional. Higher GitHub API rate limits for the skill market. `GH_TOKEN` is also accepted. |
| `PORT`                | `3000`               | Server port. |
| `NODE_ENV`            | —                    | Set to `production` to disable dev-only behavior (e.g. HMR). |

### Example: setting all variables on a Linux server

Pass them inline as a single command prefix. Build the binary first with
`bun run build` (produces `dist/agent-linux-x64`), then run:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
# or: ANTHROPIC_AUTH_TOKEN=... \
MODEL=claude-opus-4-8 \
ANTHROPIC_BASE_URL=https://gateway.example.com/anthropic \
MODEL_TIMEOUT_MS=60000 \
MAX_MODEL_MESSAGES=100 \
SESSION_STORE_FILE=.sessions.json \
WORKSPACE=./workspace \
PORT=3000 \
NODE_ENV=production \
./dist/agent-linux-x64
```

Drop any variable you don't need (e.g. `ANTHROPIC_BASE_URL`) — the defaults
from the table above apply.
