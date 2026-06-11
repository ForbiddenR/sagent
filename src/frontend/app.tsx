import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// --- types -----------------------------------------------------------------

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  error?: string;
}

type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string }
  | { type: "done" }
  | { type: "error"; message: string };

// --- chat hook (SSE streaming over /api/chat) ------------------------------

function useChat() {
  const sessionId = useRef(crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text, tools: [] },
      { id: assistantId, role: "assistant", text: "", tools: [] },
    ]);
    const patch = (fn: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: text }),
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim()) as AgentEvent;
          if (event.type === "token") patch((m) => ({ ...m, text: m.text + event.text }));
          else if (event.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, event.name] }));
          else if (event.type === "error") patch((m) => ({ ...m, error: event.message }));
        }
      }
    } catch (err) {
      patch((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    await fetch("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId.current }),
    });
    setMessages([]);
  }

  return { messages, busy, send, reset };
}

// --- components -------------------------------------------------------------

function ToolChip({ name }: { name: string }) {
  return (
    <div className="chip mb-1 inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
      🔧 {name}
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bubble-user max-w-[85%] whitespace-pre-wrap rounded-xl2 px-4 py-2.5 text-sm leading-relaxed">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      {message.tools.map((name, i) => (
        <ToolChip key={i} name={name} />
      ))}
      {message.text && (
        <div className="bubble-assistant max-w-[85%] whitespace-pre-wrap rounded-xl2 px-4 py-2.5 text-sm leading-relaxed">
          {message.text}
        </div>
      )}
      {message.error && (
        <div className="max-w-[85%] rounded-xl2 border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          Error: {message.error}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="muted flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm">Ask me anything.</p>
      <p className="text-xs">Try “what is 1234 × 9?” or “write me a haiku about the sea”.</p>
    </div>
  );
}

function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <form
      className="card flex items-end gap-2 rounded-xl2 border p-2 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder="Send a message…"
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="field max-h-40 flex-1 resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <button
        type="submit"
        disabled={busy}
        className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}

function App() {
  const { messages, busy, send, reset } = useChat();
  const listRef = useRef<HTMLElement>(null);

  // Auto-scroll to the latest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <div className="btn-primary flex h-8 w-8 items-center justify-center rounded-xl2 text-sm font-bold">
            A
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Agent</h1>
            <p className="muted text-xs leading-tight">Bun · React · LangChain</p>
          </div>
        </div>
        <button
          onClick={reset}
          className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80"
        >
          New chat
        </button>
      </header>

      <main ref={listRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </main>

      <footer className="sticky bottom-0 pb-5 pt-2" style={{ background: "var(--bg)" }}>
        <Composer busy={busy} onSend={send} />
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
