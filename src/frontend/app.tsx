import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "./components/Composer";
import { FileEditor } from "./components/FileEditor";
import { Bubble, EmptyState } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { SkillEditor } from "./components/SkillEditor";
import type { AgentEvent, Message, SessionFile, SessionSummary, Skill, SkillEditorState, SkillSummary } from "./types";
import { blankSkill, getJson } from "./utils";

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

  async function uploadFile(file: File) {
    if (!activeSessionId) return;
    const formData = new FormData();
    formData.append("file", file);
    await fetch(`/api/sessions/${activeSessionId}/upload`, {
      method: "POST",
      body: formData,
    });
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
    uploadFile,
    closeFileEditor: () => setFileEditor(null),
    closeSkillEditor: () => setSkillEditor(null),
  };
}

function App() {
  const state = useAgentPage();
  const listRef = useRef<HTMLElement>(null);
  const activeSkills = useMemo(() => new Set(state.activeSession?.activeSkills ?? []), [state.activeSession?.activeSkills]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        files={state.files}
        skills={state.skills}
        activeSkills={activeSkills}
        onLoadSession={state.loadSession}
        onCreateSession={state.createSession}
        onDeleteSession={state.deleteSession}
        onUploadFile={state.uploadFile}
        onOpenFileEditor={state.openFileEditor}
        onToggleSkill={state.toggleSkill}
        onOpenCreateSkill={state.openCreateSkill}
        onOpenEditSkill={state.openEditSkill}
      />
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
            {state.messages.length === 0 ? <EmptyState /> : state.messages.map((message) => <Bubble key={message.id} message={message} />)}
          </main>

          <footer className="sticky bottom-0 pb-5 pt-2" style={{ background: "var(--bg)" }}>
            <Composer busy={state.busy} onSend={state.send} />
          </footer>
        </div>
      </div>
      <SkillEditor editor={state.skillEditor} onClose={state.closeSkillEditor} onSave={state.saveSkill} onRemove={state.removeSkill} />
      <FileEditor editor={state.fileEditor} onClose={state.closeFileEditor} onSave={state.saveFile} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
