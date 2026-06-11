# Bun + LangChain Agent

A small agent server built with [Bun](https://bun.sh) and
[LangChain](https://js.langchain.com), backed by Claude. It demonstrates three
things in a minimal, readable way:

- **Skills** — Claude Code–style. Each skill is a folder under `skills/` with a
  `SKILL.md`. The agent sees a one-line index of every skill and loads a skill's
  full instructions *on demand* via the `load_skill` tool (progressive disclosure).
- **Memory** — in-memory conversation history per session id (lost on restart).
- **Tool calling** — `calculator`, `current_time`, and `load_skill`, wired through
  a transparent streaming tool-call loop (no `AgentExecutor`).

A single-page chat UI (**React 19**, bundled natively by Bun — no Vite/webpack)
streams responses over Server-Sent Events. Styling is Tailwind via CDN with
shadcn-style components.

## Stack

| Concern   | Choice |
|-----------|--------|
| Runtime   | Bun (runs TypeScript directly — no build step) |
| LLM       | Claude via `@langchain/anthropic` (`claude-opus-4-8` by default) |
| Tools     | `@langchain/core` `tool()` + zod schemas; `expr-eval` for safe math |
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
- **Skills**: “Write me a haiku about the sea.” → a `load_skill` chip (the `poetry`
  skill) appears, and the reply follows the skill's rules.
- **Memory**: ask a follow-up like “what did I just ask?” → prior turns are remembered.
- Restart the server → history is gone (in-memory by design).

## Project layout

```
src/
  index.ts           Bun.serve — routes: "/" (HTML) + /api/chat (SSE) + /api/reset
  agent.ts           ChatAnthropic + bindTools + streaming tool-call loop
  memory.ts          SessionStore (Map<sessionId, BaseMessage[]>)
  skills.ts          load SKILL.md folders (Bun.Glob), build the skill index
  tools.ts           calculator, current_time, load_skill
  frontend/
    index.html       HTML entry — imports app.tsx (Bun bundles it natively)
    app.tsx          React 19 chat UI (useChat hook streams SSE)
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

| Env var             | Default            | Notes |
|---------------------|--------------------|-------|
| `ANTHROPIC_API_KEY` | —                  | Required. |
| `MODEL`             | `claude-opus-4-8`  | Any Claude model id (e.g. `claude-haiku-4-5` for cheaper/faster). |
| `PORT`              | `3000`             | Server port. |
