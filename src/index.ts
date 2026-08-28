import { readdir, stat as fsStat } from "node:fs/promises";
import index from "./frontend/index.html";
import { createAgent, hasAnthropicAuth, type Agent, type ApprovalRequest } from "./agent.ts";
import { deleteSkill, loadSkills, saveSkill, type Skill, type SkillInput } from "./skills.ts";
import { loadSubagents, type SubagentDef } from "./subagents.ts";
import {
  addMarketplace,
  browseMarketplace,
  installMarketplaceSkill,
  listMarketplaces,
  removeMarketplace,
} from "./marketplace.ts";
import { appendSubagentText, appendSubagentThinking, memory, type ClientMessage } from "./memory.ts";
import { generateSessionTitle } from "./title.ts";

const PORT = Number(process.env.PORT) || 3000;
const DEV = process.env.NODE_ENV !== "production";
const WORKSPACE = process.env.WORKSPACE || `${process.cwd()}/workspace`;

if (!hasAnthropicAuth()) {
  console.warn(
    "⚠️  Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set — chat requests will fail. See .env.example.",
  );
}

let skills: Skill[] = [];
let skillNames: string[] = [];
let subagents: SubagentDef[] = [];
let agent: Agent;

interface PendingApproval {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const pendingApprovals = new Map<string, PendingApproval>();

function requestApproval(request: ApprovalRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(request.id);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    pendingApprovals.set(request.id, { resolve, timer });
  });
}

async function reloadSkills() {
  skills = await loadSkills();
  skillNames = skills.map((s) => s.name);
  subagents = await loadSubagents();
  agent = createAgent(skills, subagents, requestApproval);
  console.log(`Loaded ${skills.length} skill(s): ${skillNames.join(", ") || "(none)"}`);
  console.log(`Loaded ${subagents.length} subagent(s): ${subagents.map((s) => s.name).join(", ") || "(none)"}`);
}

await reloadSkills();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function requireSession(sessionId?: string) {
  if (!sessionId) return undefined;
  memory.ensureSession(sessionId, skillNames);
  return sessionId;
}

function skillSummaries() {
  return skills.map(({ name, description, origin }) => ({ name, description, origin }));
}

function parseSkillInput(input: unknown): SkillInput | undefined {
  const body = input as Partial<SkillInput>;
  if (!body || typeof body.name !== "string") return undefined;
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    body: typeof body.body === "string" ? body.body : "",
    origin: typeof body.origin === "string" ? body.origin : undefined,
  };
}

function safeSessionWorkspace(sessionId: string): string {
  if (!sessionId || sessionId.includes("\0") || sessionId.includes("/") || sessionId.includes("\\") || sessionId === "." || sessionId === "..") {
    throw new Error("Invalid session id");
  }
  return `${WORKSPACE.replace(/\/+$/, "")}/${sessionId}`;
}

function safeWorkspacePath(sessionId: string, path: string): string {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`Path "${path}" must be relative to the session workspace`);
  }

  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`Path "${path}" is outside session workspace`);
    }
    parts.push(segment);
  }

  if (parts.length === 0) throw new Error("File path is required");
  return `${safeSessionWorkspace(sessionId)}/${parts.join("/")}`;
}

function safeUploadFileName(name: string): string {
  const fileName = name.split(/[\\/]/).pop() ?? "";
  if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
    throw new Error("Invalid upload filename");
  }
  return fileName;
}

interface WorkspaceEntry {
  name: string;
  size: number;
  modified: string;
  isDir: boolean;
}

async function listSessionFiles(sessionId: string): Promise<WorkspaceEntry[]> {
  const root = safeSessionWorkspace(sessionId);
  const files: WorkspaceEntry[] = [];

  async function walk(rel: string) {
    const dir = rel ? `${root}/${rel}` : root;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      try {
        const info = await fsStat(`${dir}/${entry.name}`);
        files.push({
          name: path,
          size: info.isDirectory() ? 0 : info.size,
          modified: info.mtime.toISOString(),
          isDir: info.isDirectory(),
        });
        if (info.isDirectory()) await walk(path);
      } catch {
        // skip unreadable entries
      }
    }
  }

  await walk("");
  files.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return files;
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  // Bundles + serves the React frontend natively (JSX/TSX transpiled on the fly).
  development: DEV ? { hmr: true } : false,
  routes: {
    // The HTML entry imports ./app.tsx, which Bun bundles automatically.
    "/": index,

    "/api/sessions": {
      GET() {
        return json({ sessions: memory.listSessions() });
      },
      async POST(req) {
        const body = (await req.json().catch(() => ({}))) as { title?: string };
        const session = memory.createSession(body.title, skillNames);
        return json({ session });
      },
    },

    "/api/sessions/:id": {
      GET(req) {
        const id = req.params.id;
        const session = memory.getSession(id);
        if (!session) return json({ error: "Session not found" }, 404);
        return json({ session, messages: memory.getClientMessages(id) });
      },
      async PATCH(req) {
        const id = req.params.id;
        if (!memory.getSession(id)) return json({ error: "Session not found" }, 404);
        const body = (await req.json().catch(() => ({}))) as { title?: string };
        if (typeof body.title !== "string" || !body.title.trim()) {
          return json({ error: "title is required" }, 400);
        }
        const session = memory.setTitle(id, body.title, "user");
        return json({ session });
      },
      DELETE(req) {
        const deleted = memory.deleteSession(req.params.id);
        return json({ ok: deleted });
      },
    },

    "/api/sessions/:id/reset": {
      POST(req) {
        const id = requireSession(req.params.id);
        if (id) memory.reset(id);
        return json({ ok: true, session: id ? memory.getSession(id) : undefined });
      },
    },

    "/api/sessions/:id/mode": {
      GET(req) {
        const id = requireSession(req.params.id);
        return json({ mode: id ? memory.getMode(id) : "build" });
      },
      async POST(req) {
        const id = requireSession(req.params.id);
        const body = (await req.json().catch(() => ({}))) as { mode?: string };
        if (!id) return json({ error: "session not found" }, 404);
        if (body.mode !== "plan" && body.mode !== "build") {
          return json({ error: "mode must be 'plan' or 'build'" }, 400);
        }
        const session = memory.setMode(id, body.mode);
        return json({ session, mode: session.mode });
      },
    },

    "/api/sessions/:id/thinking": {
      GET(req) {
        const id = requireSession(req.params.id);
        return json({ thinking: id ? memory.getThinking(id) : "high" });
      },
      async POST(req) {
        const id = requireSession(req.params.id);
        const body = (await req.json().catch(() => ({}))) as { thinking?: string };
        if (!id) return json({ error: "session not found" }, 404);
        const allowed = ["low", "medium", "high", "xhigh", "max"] as const;
        if (!allowed.includes(body.thinking as (typeof allowed)[number])) {
          return json({ error: "thinking must be 'low', 'medium', 'high', 'xhigh', or 'max'" }, 400);
        }
        const session = memory.setThinking(id, body.thinking as (typeof allowed)[number]);
        return json({ session, thinking: session.thinking });
      },
    },

    "/api/sessions/:id/skills": {
      GET(req) {
        const id = requireSession(req.params.id);
        return json({ activeSkills: id ? memory.getActiveSkills(id, skillNames) : [] });
      },
      async POST(req) {
        const id = requireSession(req.params.id);
        const body = (await req.json().catch(() => ({}))) as { activeSkills?: string[] };
        if (!id || !Array.isArray(body.activeSkills)) return json({ error: "activeSkills array required" }, 400);
        const session = memory.setActiveSkills(id, body.activeSkills, skillNames);
        return json({ session, activeSkills: session.activeSkills });
      },
    },

    "/api/sessions/:id/upload": {
      async POST(req) {
        const id = req.params.id;
        try {
          const formData = await req.formData();
          const file = formData.get("file") as File;
          if (!file) return json({ error: "No file provided" }, 400);

          const fileName = safeUploadFileName(file.name);
          const filePath = safeWorkspacePath(id, fileName);
          await Bun.write(filePath, file);

          return json({ ok: true, fileName });
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
      },
    },

    "/api/sessions/:id/files": {
      async GET(req) {
        const id = req.params.id;
        try {
          return json({ files: await listSessionFiles(id) });
        } catch {
          return json({ files: [] });
        }
      },
    },

    "/api/sessions/:id/files/:path": {
      async GET(req) {
        const { id, path } = req.params;
        try {
          const filePath = safeWorkspacePath(id, path);
          const file = Bun.file(filePath);
          if (!(await file.exists())) return json({ error: "File not found" }, 404);
          const content = await file.text();
          return json({ content });
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
      },
      async PUT(req) {
        const { id, path } = req.params;
        try {
          const filePath = safeWorkspacePath(id, path);
          const body = (await req.json()) as { content: string };
          await Bun.write(filePath, body.content);
          return json({ ok: true });
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
      },
    },

    "/api/approvals/:id": {
      async POST(req) {
        const pending = pendingApprovals.get(req.params.id);
        if (!pending) return json({ error: "Approval request not found or expired" }, 404);

        const body = (await req.json().catch(() => ({}))) as { approved?: boolean };
        clearTimeout(pending.timer);
        pendingApprovals.delete(req.params.id);
        pending.resolve(body.approved === true);
        return json({ ok: true });
      },
    },

    "/api/subagents": {
      GET() {
        return json({
          subagents: subagents.map(({ name, description, tools }) => ({ name, description, tools })),
        });
      },
    },

    "/api/skills": {
      GET() {
        return json({ skills: skillSummaries() });
      },
      async POST(req) {
        const input = parseSkillInput(await req.json().catch(() => ({})));
        if (!input) return json({ error: "name, description, and body are required" }, 400);
        const saved = await saveSkill(input);
        await reloadSkills();
        memory.enableSkillForAll(saved.name);
        return json({ skill: saved, skills: skillSummaries() });
      },
    },

    "/api/skills/:name": {
      GET(req) {
        const skill = skills.find((s) => s.name === req.params.name);
        if (!skill) return json({ error: "Skill not found" }, 404);
        return json({ skill });
      },
      async PUT(req) {
        const input = parseSkillInput(await req.json().catch(() => ({})));
        if (!input) return json({ error: "name, description, and body are required" }, 400);
        const saved = await saveSkill({ ...input, name: req.params.name });
        await reloadSkills();
        return json({ skill: saved, skills: skillSummaries() });
      },
      async DELETE(req) {
        const deleted = await deleteSkill(req.params.name);
        await reloadSkills();
        memory.disableSkillForAll(req.params.name);
        return json({ ok: deleted, skills: skillSummaries() });
      },
    },

    "/api/marketplaces": {
      GET: async () => json({ marketplaces: await listMarketplaces() }),
      async POST(req) {
        const body = (await req.json().catch(() => ({}))) as { address?: string };
        if (typeof body.address !== "string" || !body.address.trim()) {
          return json({ error: "address is required (owner/repo, git URL, marketplace.json URL, or local path)" }, 400);
        }
        try {
          const marketplace = await addMarketplace(body.address);
          return json({ marketplace, marketplaces: await listMarketplaces() });
        } catch (err) {
          return json({ error: (err as Error).message }, 400);
        }
      },
    },

    "/api/marketplaces/:id": {
      async DELETE(req) {
        const deleted = await removeMarketplace(req.params.id);
        if (!deleted) return json({ error: "Marketplace not found" }, 404);
        return json({ ok: true, marketplaces: await listMarketplaces() });
      },
    },

    "/api/marketplaces/:id/skills": {
      async GET(req) {
        try {
          const catalog = await browseMarketplace(req.params.id);
          return json(catalog);
        } catch (err) {
          const message = (err as Error).message;
          const status = message === "Marketplace not found" ? 404 : 400;
          return json({ error: message }, status);
        }
      },
    },

    "/api/marketplaces/:id/install": {
      async POST(req) {
        const body = (await req.json().catch(() => ({}))) as { name?: string };
        if (typeof body.name !== "string" || !body.name.trim()) {
          return json({ error: "name is required" }, 400);
        }
        try {
          const skill = await installMarketplaceSkill(req.params.id, body.name.trim());
          await reloadSkills();
          memory.enableSkillForAll(skill.name);
          return json({ skill, skills: skillSummaries() });
        } catch (err) {
          const message = (err as Error).message;
          const status = message === "Marketplace not found" ? 404 : 400;
          return json({ error: message }, status);
        }
      },
    },

    // Stream a chat turn as Server-Sent Events.
    "/api/chat": {
      async POST(req) {
        let body: { sessionId?: string; message?: string };
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const { sessionId, message } = body;
        if (!sessionId || !message) {
          return json({ error: "sessionId and message are required" }, 400);
        }
        memory.ensureSession(sessionId, skillNames);
        const userMessage: ClientMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text: message,
          tools: [],
        };
        memory.appendClientMessage(sessionId, userMessage);

        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            let closed = false;
            const heartbeat = setInterval(() => {
              enqueue(enc.encode(": keep-alive\n\n"));
            }, 5_000);

            function enqueue(bytes: Uint8Array) {
              if (closed) return false;
              try {
                controller.enqueue(bytes);
                return true;
              } catch {
                closed = true;
                clearInterval(heartbeat);
                return false;
              }
            }

            function closeStream() {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              try {
                controller.close();
              } catch {
                // already closed by a client disconnect / refresh
              }
            }

            const assistantMessage: ClientMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "",
              thinking: "",
              tools: [],
              toolDetails: [],
              skills: [],
              subagents: [],
              completed: false,
            };
            const send = (event: unknown) =>
              enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));

            const run = (async () => {
            const titleTask = memory.needsAutoTitle(sessionId)
              ? generateSessionTitle(message)
                  .then((title) => {
                    const session = memory.setTitle(sessionId, title, "auto");
                    if (session && !closed) send({ type: "title", title: session.title });
                  })
                  .catch((err) => {
                    console.warn(`⚠️  Session title generation failed: ${(err as Error).message}`);
                  })
              : Promise.resolve();

            try {
              for await (const event of agent.run(sessionId, message)) {
                if (closed || req.signal.aborted) break;
                if (event.type === "token") assistantMessage.text += event.text;
                else if (event.type === "thinking") assistantMessage.thinking = (assistantMessage.thinking ?? "") + event.text;
                else if (event.type === "tool") {
                  assistantMessage.tools.push(event.name);
                  assistantMessage.toolDetails?.push({ name: event.name, args: event.args });
                }
                else if (event.type === "skill") assistantMessage.skills?.push(event.name);
                else if (event.type === "subagent_start") {
                  assistantMessage.subagents?.push({
                    id: event.id,
                    name: event.name,
                    description: event.description,
                    prompt: event.prompt,
                    tools: [],
                    skills: [],
                    steps: [],
                    done: false,
                  });
                } else if (event.type === "subagent_token") {
                  const run = assistantMessage.subagents?.find((s) => s.id === event.id);
                  if (run) appendSubagentText(run, event.text);
                } else if (event.type === "subagent_thinking") {
                  const run = assistantMessage.subagents?.find((s) => s.id === event.id);
                  if (run) appendSubagentThinking(run, event.text);
                } else if (event.type === "subagent_tool") {
                  const run = assistantMessage.subagents?.find((s) => s.id === event.id);
                  if (run) {
                    run.tools.push({ name: event.name, args: event.args });
                    (run.steps ?? (run.steps = [])).push({ type: "tool", name: event.name, args: event.args });
                  }
                } else if (event.type === "subagent_skill") {
                  const run = assistantMessage.subagents?.find((s) => s.id === event.id);
                  if (run) {
                    run.skills.push(event.name);
                    (run.steps ?? (run.steps = [])).push({ type: "skill", name: event.name });
                  }
                } else if (event.type === "subagent_done") {
                  const run = assistantMessage.subagents?.find((s) => s.id === event.id);
                  if (run) {
                    run.text = event.text || run.text;
                    run.done = true;
                  }
                }
                else if (event.type === "done") {
                  assistantMessage.text = event.text || assistantMessage.text;
                  assistantMessage.completed = true;
                } else if (event.type === "timeout") {
                  assistantMessage.error = event.message;
                  assistantMessage.timeout = true;
                  assistantMessage.completed = true;
                } else if (event.type === "error") assistantMessage.error = event.message;
                send(event);
              }
            } catch (err) {
              if (!closed && !req.signal.aborted) {
                const message = (err as Error).message;
                assistantMessage.error = message;
                send({ type: "error", message });
              }
            } finally {
              await titleTask;
              if (!assistantMessage.completed && !assistantMessage.error) {
                assistantMessage.completed = true;
              }
              memory.appendClientMessage(sessionId, assistantMessage);
              closeStream();
            }
            })();

            req.signal.addEventListener("abort", () => closeStream(), { once: true });
          },
          cancel() {
            // Client disconnected (refresh / navigation). Heartbeat is cleared in closeStream.
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      },
    },

    // Backwards-compatible reset endpoint used by earlier UI versions.
    "/api/reset": {
      async POST(req) {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        if (sessionId) memory.reset(sessionId);
        return json({ ok: true });
      },
    },
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Agent server running at http://localhost:${server.port}`);
