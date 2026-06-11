import index from "./frontend/index.html";
import { createAgent } from "./agent.ts";
import { loadSkills } from "./skills.ts";
import { memory } from "./memory.ts";

const PORT = Number(process.env.PORT) || 3000;
const DEV = process.env.NODE_ENV !== "production";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠️  ANTHROPIC_API_KEY is not set — chat requests will fail. See .env.example.");
}

// Load skills once at boot and build a single shared agent.
const skills = await loadSkills();
console.log(`Loaded ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ") || "(none)"}`);
const agent = createAgent(skills);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const server = Bun.serve({
  port: PORT,
  // Bundles + serves the React frontend natively (JSX/TSX transpiled on the fly).
  development: DEV ? { hmr: true } : false,
  routes: {
    // The HTML entry imports ./app.tsx, which Bun bundles automatically.
    "/": index,

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

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (event: unknown) =>
              controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
            try {
              for await (const event of agent.run(sessionId, message)) {
                send(event);
              }
            } catch (err) {
              send({ type: "error", message: (err as Error).message });
            } finally {
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

    // Clear a session's memory.
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
