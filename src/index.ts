import index from "./frontend/index.html";
import { createAgent, type Agent, type ApprovalRequest } from "./agent.ts";
import { deleteSkill, loadSkills, saveSkill, type Skill, type SkillInput } from "./skills.ts";
import { memory, type ClientMessage } from "./memory.ts";

const PORT = Number(process.env.PORT) || 3000;
const DEV = process.env.NODE_ENV !== "production";
const WORKSPACE = process.env.WORKSPACE || `${process.cwd()}/workspace`;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY is not set — chat requests will fail. See .env.example.");
}

let skills: Skill[] = [];
let skillNames: string[] = [];
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
  agent = createAgent(skills, requestApproval);
  console.log(`Loaded ${skills.length} skill(s): ${skillNames.join(", ") || "(none)"}`);
}

await reloadSkills();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function requireSession(sessionId?: string) {
  if (!sessionId) return undefined;
  memory.ensureSession(sessionId, skillNames);
  return sessionId;
}

function parseSkillInput(input: unknown): SkillInput | undefined {
  const body = input as Partial<SkillInput>;
  if (!body || typeof body.name !== "string") return undefined;
  return {
    name: body.name,
    description: typeof body.description === "string" ? body.description : "",
    body: typeof body.body === "string" ? body.body : "",
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
          const sessionWorkspace = safeSessionWorkspace(id);
          const files: { name: string; size: number; modified: string; isDir: boolean }[] = [];
          const glob = new Bun.Glob("**/*");
          for await (const path of glob.scan({ cwd: sessionWorkspace })) {
            const fullPath = safeWorkspacePath(id, path);
            const file = Bun.file(fullPath);
            const stat = await file.stat();
            files.push({
              name: path,
              size: file.size,
              modified: new Date(stat.mtime).toISOString(),
              isDir: stat.isDirectory(),
            });
          }
          return json({ files });
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

    "/api/skills": {
      GET() {
        return json({
          skills: skills.map(({ name, description }) => ({ name, description })),
        });
      },
      async POST(req) {
        const input = parseSkillInput(await req.json().catch(() => ({})));
        if (!input) return json({ error: "name, description, and body are required" }, 400);
        const saved = await saveSkill(input);
        await reloadSkills();
        memory.enableSkillForAll(saved.name);
        return json({ skill: saved, skills: skills.map(({ name, description }) => ({ name, description })) });
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
        return json({ skill: saved, skills: skills.map(({ name, description }) => ({ name, description })) });
      },
      async DELETE(req) {
        const deleted = await deleteSkill(req.params.name);
        await reloadSkills();
        memory.disableSkillForAll(req.params.name);
        return json({ ok: deleted, skills: skills.map(({ name, description }) => ({ name, description })) });
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
          async start(controller) {
            const enc = new TextEncoder();
            const heartbeat = setInterval(() => {
              controller.enqueue(enc.encode(": keep-alive\n\n"));
            }, 5_000);
            const assistantMessage: ClientMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              text: "",
              tools: [],
              toolDetails: [],
              skills: [],
              completed: false,
            };
            const send = (event: unknown) =>
              controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
            try {
              for await (const event of agent.run(sessionId, message)) {
                if (event.type === "token") assistantMessage.text += event.text;
                else if (event.type === "tool") {
                  assistantMessage.tools.push(event.name);
                  assistantMessage.toolDetails?.push({ name: event.name, args: event.args });
                }
                else if (event.type === "skill") assistantMessage.skills?.push(event.name);
                else if (event.type === "done") {
                  assistantMessage.text = event.text || assistantMessage.text;
                  assistantMessage.completed = true;
                } else if (event.type === "error") assistantMessage.error = event.message;
                send(event);
              }
            } catch (err) {
              const message = (err as Error).message;
              assistantMessage.error = message;
              send({ type: "error", message });
            } finally {
              clearInterval(heartbeat);
              memory.appendClientMessage(sessionId, assistantMessage);
              controller.close();
            }
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
