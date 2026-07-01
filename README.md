# SAgent

A small agent server built with [Bun](https://bun.sh) and
[LangGraph](https://langchain-ai.github.io/langgraphjs/), backed by Claude. It
demonstrates a few things in a minimal, readable way:

- **Skills** — Claude Code–style. Each skill is a folder under `skills/` with a
  `SKILL.md`. The agent sees a one-line index of every skill and loads a skill's
  full instructions *on demand* via the `load_skill` tool (progressive disclosure).
- **Memory** — conversation history per session id, **persisted to `.sessions.json`**
  so sessions survive server restarts.
- **Agent loop** — a LangGraph `StateGraph` (`model` → `tools` → `model` …) with
  streaming tokens, a tool-round cap, and an abort-on-stall timeout that notifies
  the user when the API is unresponsive.
- **Tools** — `calculator`, `current_time`, `read_file`, `write_file`, `run_bash`
  (with human-in-the-loop approval), `search_workspace` (semantic, RAG-backed), and
  `load_skill`.
- **Workspace** — each session gets a private folder for files; upload, browse,
  and edit them from the UI.

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
| Tools     | `@langchain/core` `tool()` + zod schemas; `expr-eval` for safe math |
| Retrieval | `@langchain/textsplitters` + in-memory vector store (`search_workspace`) |
| Frontend  | React 19, bundled by Bun's native HTML import (HMR in dev); Tailwind via CDN |

## Setup

```bash
bun install
cp .env.example .env          # then set ANTHROPIC_API_KEY
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
- **Files & bash**: ask the agent to create or read a file in its workspace, or to run
  a shell command → `run_bash` requests approval first via an inline card; approve to
  run it. Browse/edit uploaded files from the file panel.
- **Semantic search**: with files in the workspace, ask something like “search the
  workspace for notes about caching” → `search_workspace` finds relevant chunks.
- **Sessions**: use the sidebar to create, choose, reset, and delete independent
  sessions. Each session has its own memory and enabled-skill set.
- **Memory**: ask a follow-up like “what did I just ask?” → prior turns in the
  selected session are remembered.
- **Timeouts**: if the model stops responding, the request is aborted after
  `MODEL_TIMEOUT_MS` and a “⏱ Request timed out — check the API” notice appears.
- Restart the server → sessions and history are restored from `.sessions.json`.

## Project layout

```
src/
  index.ts           Bun.serve — routes: "/" (HTML), /api/chat, /api/sessions,
                     /api/skills, /api/approvals, files & upload endpoints
  agent.ts           LangGraph StateGraph (model/tools nodes) + streaming + timeout
  memory.ts          SessionStore — sessions, enabled skills, messages (persisted)
  rag.ts             in-memory vector store backing search_workspace
  skills.ts          load SKILL.md folders (Bun.Glob), build the skill index
  tools.ts           calculator, current_time, read_file, write_file, run_bash,
                     search_workspace, load_skill
  frontend/
    index.html       HTML entry — imports app.tsx (Bun bundles it natively)
    app.tsx          React 19 chat UI (streams SSE; approval cards, file editor)
skills/
  calculator/SKILL.md
  poetry/SKILL.md
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

## Configuration

All options are read from the environment (Bun auto-loads `.env`). See `.env.example`.

| Env var               | Default              | Notes |
|-----------------------|----------------------|-------|
| `ANTHROPIC_API_KEY`   | —                    | Required. Get one at https://console.anthropic.com/. |
| `MODEL`               | `claude-opus-4-8`    | Any Claude model id (e.g. `claude-haiku-4-5` for cheaper/faster). |
| `ANTHROPIC_BASE_URL`  | Anthropic API        | Optional. Point at an Anthropic-compatible endpoint (gateway/proxy, e.g. LiteLLM, Cloudflare AI Gateway, a corporate proxy). Must speak the Anthropic `/v1/messages` API. Leave unset for the default. |
| `TOP_P`               | `1`                  | Top-p sampling for the model. |
| `MODEL_TIMEOUT_MS`    | `60000`              | Max ms to wait for the next model chunk before treating the request as timed out (a streaming response is not interrupted; only total silence trips it). Emits a timeout notification so the user knows to check the API. |
| `MAX_MODEL_MESSAGES`  | `100`                | Max recent messages sent back to the model for context. Full frontend session messages are still persisted separately. |
| `SESSION_STORE_FILE`  | `.sessions.json`     | Where persisted sessions are stored. |
| `WORKSPACE`           | `./workspace`        | Workspace folder for the `read_file` / `write_file` tools. |
| `PORT`                | `3000`               | Server port. |
| `NODE_ENV`            | —                    | Set to `production` to disable dev-only behavior (e.g. HMR). |

### Example: setting all variables on a Linux server

Pass them inline as a single command prefix. Build the binary first with
`bun run build` (produces `dist/agent-linux-x64`), then run:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
MODEL=claude-opus-4-8 \
ANTHROPIC_BASE_URL=https://gateway.example.com/anthropic \
TOP_P=1 \
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
