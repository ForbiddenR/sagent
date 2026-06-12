import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

// --- types -----------------------------------------------------------------

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  toolDetails?: Record<string, unknown>[];
  skills?: string[];
  completed?: boolean;
  error?: string;
}

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeSkills: string[];
}

interface SessionFile {
  name: string;
  size: number;
  modified: string;
  isDir: boolean;
}

interface SkillSummary {
  name: string;
  description: string;
}

interface Skill extends SkillSummary {
  body: string;
}

type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "skill"; name: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

type SkillEditorState = { mode: "create" | "edit"; skill: Skill } | null;

// --- helpers ----------------------------------------------------------------

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function MarkdownMessage({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="mb-2 last:mb-0">
        {renderInlineMarkdown(paragraph.join("\n"))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
        {list.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  const flushTable = () => {
    if (table.length === 0) return;
    const header = table[0];
    const rows = table.slice(2);
    blocks.push(
      <div key={`table-${blocks.length}`} className="mb-2 overflow-x-auto last:mb-0">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              {header?.map((cell, i) => (
                <th key={i} className="border border-zinc-300 px-2 py-1 text-left font-semibold dark:border-zinc-700">
                  {renderInlineMarkdown(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">
                    {renderInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    const bullet = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    const tableRow = trimmed.match(/^\|(.+)\|$/);

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (tableRow) {
      flushParagraph();
      flushList();
      const cells = tableRow[1]!.split("|").map((c) => c.trim());
      table.push(cells);
      continue;
    }

    if (heading) {
      flushParagraph();
      flushList();
      flushTable();
      const Tag = heading[1]!.length === 1 ? "h2" : "h3";
      blocks.push(
        <Tag key={`h-${blocks.length}`} className="mb-2 mt-1 font-semibold first:mt-0">
          {renderInlineMarkdown(heading[2]!)}
        </Tag>,
      );
      continue;
    }

    if (bullet) {
      flushParagraph();
      flushTable();
      list.push(bullet[1]!);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushTable();

  return <>{blocks}</>;
}

const blankSkill = (): Skill => ({ name: "", description: "", body: "# New skill\n\nWrite instructions here." });

// --- chat/session hook ------------------------------------------------------

function useAgentPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [fileEditor, setFileEditor] = useState<{ path: string; content: string } | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillEditor, setSkillEditor] = useState<SkillEditorState>(null);
  const [busy, setBusy] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  async function refreshSessions() {
    const data = await getJson<{ sessions: SessionSummary[] }>("/api/sessions");
    setSessions(data.sessions);
    return data.sessions;
  }

  async function refreshSkills() {
    const data = await getJson<{ skills: SkillSummary[] }>("/api/skills");
    setSkills(data.skills);
    return data.skills;
  }

  async function loadSession(id: string) {
    const data = await getJson<{ session: SessionSummary; messages: Message[] }>(`/api/sessions/${id}`);
    setActiveSessionId(id);
    setMessages(data.messages);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      return [data.session, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
    await refreshFiles(id);
  }

  async function refreshFiles(id: string) {
    try {
      const data = await getJson<{ files: SessionFile[] }>(`/api/sessions/${id}/files`);
      setFiles(data.files);
    } catch {
      setFiles([]);
    }
  }

  async function createSession() {
    const data = await getJson<{ session: SessionSummary }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setSessions((prev) => [data.session, ...prev]);
    setActiveSessionId(data.session.id);
    setMessages([]);
    setFiles([]);
  }

  async function deleteSession(id: string) {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeSessionId === id) {
      if (next[0]) await loadSession(next[0].id);
      else {
        setActiveSessionId(null);
        setMessages([]);
      }
    }
  }

  async function resetSession() {
    if (!activeSessionId) return;
    const data = await getJson<{ session: SessionSummary }>(`/api/sessions/${activeSessionId}/reset`, {
      method: "POST",
    });
    setMessages([]);
    setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? data.session : s)));
  }

  async function toggleSkill(name: string, enabled: boolean) {
    if (!activeSession) return;
    const active = new Set(activeSession.activeSkills);
    if (enabled) active.add(name);
    else active.delete(name);
    const data = await getJson<{ session: SessionSummary; activeSkills: string[] }>(
      `/api/sessions/${activeSession.id}/skills`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeSkills: [...active] }),
      },
    );
    setSessions((prev) => prev.map((s) => (s.id === activeSession.id ? data.session : s)));
  }

  async function openEditSkill(name: string) {
    const data = await getJson<{ skill: Skill }>(`/api/skills/${encodeURIComponent(name)}`);
    setSkillEditor({ mode: "edit", skill: data.skill });
  }

  function openCreateSkill() {
    setSkillEditor({ mode: "create", skill: blankSkill() });
  }

  async function saveSkill(skill: Skill, mode: "create" | "edit") {
    const url = mode === "create" ? "/api/skills" : `/api/skills/${encodeURIComponent(skill.name)}`;
    const data = await getJson<{ skill: Skill; skills: SkillSummary[] }>(url, {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(skill),
    });
    setSkills(data.skills);
    setSkillEditor({ mode: "edit", skill: data.skill });
    await refreshSessions();
  }

  async function removeSkill(name: string) {
    await getJson<{ ok: boolean; skills: SkillSummary[] }>(`/api/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    setSkillEditor(null);
    await Promise.all([refreshSkills(), refreshSessions()]);
  }

  async function openFileEditor(path: string) {
    if (!activeSessionId) return;
    const data = await getJson<{ content: string }>(`/api/sessions/${activeSessionId}/files/${encodeURIComponent(path)}`);
    setFileEditor({ path, content: data.content });
  }

  async function saveFile(path: string, content: string) {
    if (!activeSessionId) return;
    await getJson<{ ok: boolean }>(`/api/sessions/${activeSessionId}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setFileEditor(null);
    await refreshFiles(activeSessionId);
  }

  async function send(text: string) {
    let sessionId = activeSessionId;
    if (!sessionId) {
      const data = await getJson<{ session: SessionSummary }>("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      sessionId = data.session.id;
      setActiveSessionId(sessionId);
      setSessions((prev) => [data.session, ...prev]);
    }

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text, tools: [], completed: true },
      { id: assistantId, role: "assistant", text: "", tools: [], toolDetails: [], skills: [], completed: false },
    ]);
    const patch = (fn: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
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
          else if (event.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, event.name], toolDetails: [...(m.toolDetails ?? []), { name: event.name, args: event.args }] }));
          else if (event.type === "skill") patch((m) => ({ ...m, skills: [...(m.skills ?? []), event.name] }));
          else if (event.type === "done") patch((m) => ({ ...m, text: event.text || m.text, completed: true }));
          else if (event.type === "error") patch((m) => ({ ...m, error: event.message, completed: true }));
        }
      }
      const latest = await refreshSessions();
      const current = latest.find((s) => s.id === sessionId);
      if (current) setActiveSessionId(current.id);
    } catch (err) {
      patch((m) => ({ ...m, error: (err as Error).message, completed: true }));
    } finally {
      setBusy(false);
      if (sessionId) await refreshFiles(sessionId);
    }
  }

  useEffect(() => {
    (async () => {
      const [{ sessions }, { skills }] = await Promise.all([
        getJson<{ sessions: SessionSummary[] }>("/api/sessions"),
        getJson<{ skills: SkillSummary[] }>("/api/skills"),
      ]);
      setSkills(skills);
      if (sessions.length === 0) await createSession();
      else {
        setSessions(sessions);
        await loadSession(sessions[0]!.id);
      }
    })().catch((err) => console.error(err));
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    messages,
    files,
    fileEditor,
    skills,
    skillEditor,
    busy,
    send,
    loadSession,
    createSession,
    deleteSession,
    resetSession,
    toggleSkill,
    openEditSkill,
    openCreateSkill,
    saveSkill,
    removeSkill,
    openFileEditor,
    saveFile,
    closeFileEditor: () => setFileEditor(null),
    closeSkillEditor: () => setSkillEditor(null),
  };
}

// --- components -------------------------------------------------------------

function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  const values = Object.values(args);
  if (values.length === 0) return "";
  const str = String(values[0]);
  return str.length > 40 ? `${str.slice(0, 40)}...` : str;
}

function ToolChip({ name, args }: { name: string; args?: Record<string, unknown> }) {
  const detail = formatToolArgs(args);
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-md border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      🔧 {name}{detail && ` (${detail})`}
    </div>
  );
}

function SkillChip({ name }: { name: string }) {
  return <div className="inline-flex w-fit items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300">📘 {name}</div>;
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
    <div className="flex flex-col items-start gap-1">
      <div className="flex max-w-[85%] flex-col gap-1">
        {(message.skills ?? []).map((name, i) => <SkillChip key={`skill-${i}`} name={name} />)}
        {(message.toolDetails ?? []).map((detail, i) => <ToolChip key={`tool-${i}`} name={detail.name as string} args={detail.args as Record<string, unknown>} />)}
      </div>
      {message.text && (
        <div className="bubble-assistant max-w-[85%] rounded-xl2 px-4 py-2.5 text-sm leading-relaxed">
          <MarkdownMessage text={message.text} />
          {message.completed && <div className="muted mt-2 text-xs">response completed ✓</div>}
          {!message.completed && !message.error && <div className="muted mt-2 text-xs animate-pulse">thinking...</div>}
        </div>
      )}
      {message.error && <div className="max-w-[85%] rounded-xl2 border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700">Error: {message.error}</div>}
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

function Sidebar({ state }: { state: ReturnType<typeof useAgentPage> }) {
  const activeSkills = new Set(state.activeSession?.activeSkills ?? []);
  return (
    <aside className="card hidden h-full w-72 shrink-0 flex-col gap-4 overflow-hidden border-r p-4 md:flex">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide muted">Sessions</h2>
          <button onClick={state.createSession} className="btn-primary rounded-md px-2 py-1 text-xs font-medium">New</button>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {state.sessions.map((session) => (
            <div key={session.id} className={`group rounded-lg border p-2 ${session.id === state.activeSessionId ? "border-zinc-900 dark:border-zinc-100" : "border-transparent hover:border-zinc-200 dark:hover:border-zinc-800"}`}>
              <button onClick={() => state.loadSession(session.id)} className="w-full text-left">
                <div className="truncate text-sm font-medium">{session.title}</div>
                <div className="muted mt-0.5 text-xs">{session.messageCount} messages · {formatTime(session.updatedAt)}</div>
              </button>
              <div className="mt-2 flex gap-2 opacity-70 group-hover:opacity-100">
                <button onClick={() => state.loadSession(session.id)} className="chip rounded-md border px-2 py-0.5 text-xs">Open</button>
                <button onClick={() => state.deleteSession(session.id)} className="chip rounded-md border px-2 py-0.5 text-xs">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide muted">Files ({state.files.length})</h2>
        <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
          {state.files.length === 0 ? (
            <p className="muted text-xs">No files yet</p>
          ) : (
            state.files.filter(f => !f.isDir).map((file) => (
              <button key={file.name} onClick={() => state.openFileEditor(file.name)} className="w-full rounded border border-zinc-200 p-1.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                <div className="truncate text-xs font-medium font-mono">{file.name}</div>
                <div className="muted text-xs">{(file.size / 1024).toFixed(1)} KB</div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide muted">Skills</h2>
          <button onClick={state.openCreateSkill} className="btn-primary rounded-md px-2 py-1 text-xs font-medium">Add</button>
        </div>
        <div className="muted text-xs">{activeSkills.size}/{state.skills.length} enabled</div>
        {state.skills.map((skill) => {
          const enabled = activeSkills.has(skill.name);
          return (
            <div key={skill.name} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => state.toggleSkill(skill.name, e.target.checked)}
                  className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                />
                <div className="min-w-0 flex-1">
                  <button onClick={() => state.openEditSkill(skill.name)} className="truncate text-left text-sm font-medium hover:underline">
                    {skill.name}
                  </button>
                  <p className="muted text-xs">{skill.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </aside>
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
    <form className="card flex items-end gap-2 rounded-xl2 border p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder="Send a message…"
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); autoGrow(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        className="field max-h-40 flex-1 resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <button type="submit" disabled={busy} className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">Send</button>
    </form>
  );
}

function FileEditor({ state }: { state: ReturnType<typeof useAgentPage> }) {
  const editor = state.fileEditor;
  const [draft, setDraft] = useState(editor?.content ?? "");

  useEffect(() => {
    setDraft(editor?.content ?? "");
  }, [editor?.path]);

  if (!editor) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={state.closeFileEditor}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl2 border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold font-mono">{editor.path}</h3>
            <p className="muted text-xs">Edit file content</p>
          </div>
          <button onClick={state.closeFileEditor} className="chip rounded-md border px-2 py-1 text-xs">Close</button>
        </div>
        <div className="space-y-3 overflow-auto p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field h-96 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none"
          />
          <div className="flex justify-end">
            <button onClick={() => state.saveFile(editor.path, draft)} className="btn-primary rounded-md px-3 py-2 text-xs font-medium">
              Save file
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillEditor({ state }: { state: ReturnType<typeof useAgentPage> }) {
  const editor = state.skillEditor;
  const [draft, setDraft] = useState<Skill>(editor?.skill ?? blankSkill());

  useEffect(() => {
    setDraft(editor?.skill ?? blankSkill());
  }, [editor?.skill.name, editor?.mode]);

  if (!editor) return null;
  const isEdit = editor.mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={state.closeSkillEditor}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl2 border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold">{isEdit ? "Edit skill" : "Add skill"}</h3>
            <p className="muted text-xs">Skills are saved as <code>skills/&lt;name&gt;/SKILL.md</code>.</p>
          </div>
          <button onClick={state.closeSkillEditor} className="chip rounded-md border px-2 py-1 text-xs">Close</button>
        </div>
        <div className="space-y-3 overflow-auto p-4">
          <label className="block text-xs font-medium">
            Name
            <input
              value={draft.name}
              disabled={isEdit}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="field mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="my-skill"
            />
          </label>
          <label className="block text-xs font-medium">
            Description
            <input
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="field mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="One-line description"
            />
          </label>
          <label className="block text-xs font-medium">
            Instructions
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              className="field mt-1 h-72 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none"
            />
          </label>
          <div className="flex justify-between gap-2">
            <div>
              {isEdit && (
                <button onClick={() => state.removeSkill(draft.name)} className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50">
                  Delete skill
                </button>
              )}
            </div>
            <button onClick={() => state.saveSkill(draft, editor.mode)} className="btn-primary rounded-md px-3 py-2 text-xs font-medium">
              Save skill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const state = useAgentPage();
  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  return (
    <div className="flex h-full">
      <Sidebar state={state} />
      <div className="flex h-full min-w-0 flex-1 flex-col px-4">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <header className="flex items-center justify-between py-5">
            <div className="flex items-center gap-2.5">
              <div className="btn-primary flex h-8 w-8 items-center justify-center rounded-xl2 text-sm font-bold">A</div>
              <div>
                <h1 className="text-sm font-semibold leading-tight">{state.activeSession?.title ?? "Agent"}</h1>
                <p className="muted text-xs leading-tight">Bun · React · LangChain · {state.activeSession?.activeSkills.length ?? 0} skills enabled</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={state.openCreateSkill} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80 md:hidden">Add skill</button>
              <button onClick={state.resetSession} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80">Clear messages</button>
            </div>
          </header>

          <main ref={listRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
            {state.messages.length === 0 ? <EmptyState /> : state.messages.map((m) => <Bubble key={m.id} message={m} />)}
          </main>

          <footer className="sticky bottom-0 pb-5 pt-2" style={{ background: "var(--bg)" }}>
            <Composer busy={state.busy} onSend={state.send} />
          </footer>
        </div>
      </div>
      <SkillEditor state={state} />
      <FileEditor state={state} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
