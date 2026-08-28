import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "./components/Composer";
import { FileEditor } from "./components/FileEditor";
import { FileExplorer } from "./components/FileExplorer";
import { Bubble, EmptyState } from "./components/Message";
import { Sidebar } from "./components/Sidebar";
import { SkillEditor } from "./components/SkillEditor";
import { SkillMarket } from "./components/SkillMarket";
import type { AgentEvent, CatalogSkill, MarketplaceSource, Message, SessionFile, SessionMode, SessionSummary, Skill, SkillEditorState, SkillSummary, SubagentRun, SubagentStep, SubagentSummary, ThinkingLevel } from "./types";
import { blankSkill, getJson } from "./utils";

function appendRunText(run: SubagentRun, text: string): SubagentRun {
  const steps: SubagentStep[] = [...(run.steps ?? [])];
  const last = steps.at(-1);
  if (last?.type === "text") steps[steps.length - 1] = { type: "text", text: last.text + text };
  else steps.push({ type: "text", text });
  return { ...run, text: (run.text ?? "") + text, steps };
}

function appendRunThinking(run: SubagentRun, text: string): SubagentRun {
  const steps: SubagentStep[] = [...(run.steps ?? [])];
  const last = steps.at(-1);
  if (last?.type === "thinking") steps[steps.length - 1] = { type: "thinking", text: last.text + text };
  else steps.push({ type: "thinking", text });
  return { ...run, thinking: (run.thinking ?? "") + text, steps };
}

function useAgentPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({});
  const [files, setFiles] = useState<SessionFile[]>([]);
  const [fileEditor, setFileEditor] = useState<{ path: string; content: string } | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [skillEditor, setSkillEditor] = useState<SkillEditorState>(null);
  const [busySessions, setBusySessions] = useState<Set<string>>(() => new Set());
  const [marketplaces, setMarketplaces] = useState<MarketplaceSource[]>([]);
  const [selectedMarketplaceId, setSelectedMarketplaceId] = useState<string | null>(null);
  const [marketCatalog, setMarketCatalog] = useState<CatalogSkill[] | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [marketOpen, setMarketOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  const activeSessionIdRef = useRef<string | null>(null);
  const busySessionsRef = useRef<Set<string>>(new Set());
  const loadSeq = useRef(0);
  const abortBySession = useRef(new Map<string, AbortController>());

  activeSessionIdRef.current = activeSessionId;

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const messages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : [];
  const busy = Boolean(activeSessionId && busySessions.has(activeSessionId));

  function setBusySession(id: string, nextBusy: boolean) {
    const next = new Set(busySessionsRef.current);
    if (nextBusy) next.add(id);
    else next.delete(id);
    busySessionsRef.current = next;
    setBusySessions(next);
  }

  function patchSessionMessages(id: string, updater: (prev: Message[]) => Message[]) {
    setMessagesBySession((prev) => ({ ...prev, [id]: updater(prev[id] ?? []) }));
  }

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

  async function loadMarketplace(id: string) {
    setSelectedMarketplaceId(id);
    setMarketLoading(true);
    setMarketError(null);
    try {
      const data = await getJson<{ skills: CatalogSkill[] }>(`/api/marketplaces/${id}/skills`);
      setMarketCatalog(data.skills);
    } catch (err) {
      setMarketCatalog([]);
      setMarketError((err as Error).message);
    } finally {
      setMarketLoading(false);
    }
  }

  async function addMarketplace(address: string) {
    setMarketError(null);
    try {
      const data = await getJson<{ marketplace: MarketplaceSource; marketplaces: MarketplaceSource[] }>("/api/marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      setMarketplaces(data.marketplaces);
      await loadMarketplace(data.marketplace.id);
    } catch (err) {
      setMarketError((err as Error).message);
    }
  }

  async function removeMarketplace(id: string) {
    const data = await getJson<{ ok: boolean; marketplaces: MarketplaceSource[] }>(`/api/marketplaces/${id}`, {
      method: "DELETE",
    });
    setMarketplaces(data.marketplaces);
    if (selectedMarketplaceId === id) {
      setSelectedMarketplaceId(null);
      setMarketCatalog(null);
      setMarketError(null);
    }
  }

  async function installMarketSkill(name: string) {
    if (!selectedMarketplaceId) return;
    setInstallingSkill(name);
    setMarketError(null);
    try {
      const data = await getJson<{ skill: Skill; skills: SkillSummary[] }>(`/api/marketplaces/${selectedMarketplaceId}/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setSkills(data.skills);
      setMarketCatalog((prev) => prev?.map((s) => (s.name === name ? { ...s, installed: true } : s)) ?? prev);
      await refreshSessions();
    } catch (err) {
      setMarketError((err as Error).message);
    } finally {
      setInstallingSkill(null);
    }
  }

  async function loadSession(id: string) {
    const seq = ++loadSeq.current;
    setActiveSessionId(id);

    if (!busySessionsRef.current.has(id)) {
      const data = await getJson<{ session: SessionSummary; messages: Message[] }>(`/api/sessions/${id}`);
      if (seq !== loadSeq.current) return;
      setMessagesBySession((prev) => ({ ...prev, [id]: data.messages }));
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        return [data.session, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    } else if (seq !== loadSeq.current) {
      return;
    }

    await refreshFiles(id);
  }

  async function refreshFiles(id: string) {
    try {
      const data = await getJson<{ files: SessionFile[] }>(`/api/sessions/${id}/files`);
      if (activeSessionIdRef.current !== id) return;
      setFiles(data.files);
    } catch {
      if (activeSessionIdRef.current !== id) return;
      setFiles([]);
    }
  }

  async function createSession() {
    const data = await getJson<{ session: SessionSummary }>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    loadSeq.current += 1;
    setSessions((prev) => [data.session, ...prev]);
    setActiveSessionId(data.session.id);
    setMessagesBySession((prev) => ({ ...prev, [data.session.id]: [] }));
    setFiles([]);
  }

  function abortSession(id: string) {
    abortBySession.current.get(id)?.abort();
    abortBySession.current.delete(id);
  }

  async function deleteSession(id: string) {
    abortSession(id);
    setBusySession(id, false);
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    setMessagesBySession((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    if (activeSessionId === id) {
      if (next[0]) await loadSession(next[0].id);
      else {
        loadSeq.current += 1;
        setActiveSessionId(null);
        setFiles([]);
      }
    }
  }

  async function resetSession() {
    if (!activeSessionId) return;
    abortSession(activeSessionId);
    setBusySession(activeSessionId, false);
    const data = await getJson<{ session: SessionSummary }>(`/api/sessions/${activeSessionId}/reset`, {
      method: "POST",
    });
    setMessagesBySession((prev) => ({ ...prev, [activeSessionId]: [] }));
    setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? data.session : s)));
  }

  async function renameSession(id: string, title: string) {
    const data = await getJson<{ session: SessionSummary }>(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setSessions((prev) => prev.map((s) => (s.id === id ? data.session : s)));
  }

  async function setMode(mode: SessionMode) {
    if (!activeSessionId) return;
    const data = await getJson<{ session: SessionSummary; mode: SessionMode }>(
      `/api/sessions/${activeSessionId}/mode`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      },
    );
    setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? data.session : s)));
  }

  async function setThinking(thinking: ThinkingLevel) {
    if (!activeSessionId) return;
    const data = await getJson<{ session: SessionSummary; thinking: ThinkingLevel }>(
      `/api/sessions/${activeSessionId}/thinking`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thinking }),
      },
    );
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

  async function handleApproval(id: string, approved: boolean) {
    await getJson<{ ok: boolean }>(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved }),
    });
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
      loadSeq.current += 1;
      setActiveSessionId(sessionId);
      setSessions((prev) => [data.session, ...prev]);
      setMessagesBySession((prev) => ({ ...prev, [sessionId!]: [] }));
    }

    const assistantId = crypto.randomUUID();
    patchSessionMessages(sessionId, (prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text, tools: [], completed: true },
      { id: assistantId, role: "assistant", text: "", thinking: "", tools: [], toolDetails: [], skills: [], subagents: [], completed: false },
    ]);
    const patch = (fn: (m: Message) => Message) =>
      patchSessionMessages(sessionId, (prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    abortSession(sessionId);
    const ac = new AbortController();
    abortBySession.current.set(sessionId, ac);
    setBusySession(sessionId, true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
        signal: ac.signal,
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
          else if (event.type === "thinking") patch((m) => ({ ...m, thinking: (m.thinking ?? "") + event.text }));
          else if (event.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, event.name], toolDetails: [...(m.toolDetails ?? []), { name: event.name, args: event.args }] }));
          else if (event.type === "skill") patch((m) => ({ ...m, skills: [...(m.skills ?? []), event.name] }));
          else if (event.type === "subagent_start") patch((m) => ({
            ...m,
            subagents: [...(m.subagents ?? []), {
              id: event.id,
              name: event.name,
              description: event.description,
              prompt: event.prompt,
              tools: [],
              skills: [],
              steps: [],
              done: false,
            }],
          }));
          else if (event.type === "subagent_token") patch((m) => ({
            ...m,
            subagents: (m.subagents ?? []).map((s) => s.id === event.id ? appendRunText(s, event.text) : s),
          }));
          else if (event.type === "subagent_thinking") patch((m) => ({
            ...m,
            subagents: (m.subagents ?? []).map((s) => s.id === event.id ? appendRunThinking(s, event.text) : s),
          }));
          else if (event.type === "subagent_tool") patch((m) => ({
            ...m,
            subagents: (m.subagents ?? []).map((s) => s.id === event.id
              ? { ...s, tools: [...s.tools, { name: event.name, args: event.args }], steps: [...(s.steps ?? []), { type: "tool" as const, name: event.name, args: event.args }] }
              : s),
          }));
          else if (event.type === "subagent_skill") patch((m) => ({
            ...m,
            subagents: (m.subagents ?? []).map((s) => s.id === event.id
              ? { ...s, skills: [...s.skills, event.name], steps: [...(s.steps ?? []), { type: "skill" as const, name: event.name }] }
              : s),
          }));
          else if (event.type === "subagent_done") patch((m) => ({
            ...m,
            subagents: (m.subagents ?? []).map((s) => s.id === event.id ? { ...s, text: event.text || s.text, done: true } : s),
          }));
          else if (event.type === "approval_request") patch((m) => ({
            ...m,
            pendingApprovals: [...(m.pendingApprovals ?? []), { id: event.id, name: event.name, args: event.args }],
          }));
          else if (event.type === "approval_result") patch((m) => ({
            ...m,
            pendingApprovals: (m.pendingApprovals ?? []).filter((a) => a.id !== event.id),
          }));
          else if (event.type === "mode") {
            const nextMode = event.mode;
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, mode: nextMode } : s)),
            );
          }
          else if (event.type === "title") {
            const nextTitle = event.title;
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, title: nextTitle, titleSource: "auto" } : s)),
            );
          }
          else if (event.type === "done") patch((m) => ({ ...m, text: event.text || m.text, completed: true }));
          else if (event.type === "timeout") patch((m) => ({ ...m, error: event.message, timeout: true, completed: true }));
          else if (event.type === "error") patch((m) => ({ ...m, error: event.message, completed: true }));
        }
      }
      await refreshSessions();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      patch((m) => ({ ...m, error: (err as Error).message, completed: true }));
    } finally {
      if (abortBySession.current.get(sessionId) === ac) abortBySession.current.delete(sessionId);
      setBusySession(sessionId, false);
      if (activeSessionIdRef.current === sessionId) await refreshFiles(sessionId);
    }
  }

  useEffect(() => {
    (async () => {
      const [{ sessions }, { skills }, { subagents }, { marketplaces }] = await Promise.all([
        getJson<{ sessions: SessionSummary[] }>("/api/sessions"),
        getJson<{ skills: SkillSummary[] }>("/api/skills"),
        getJson<{ subagents: SubagentSummary[] }>("/api/subagents"),
        getJson<{ marketplaces: MarketplaceSource[] }>("/api/marketplaces"),
      ]);
      setSkills(skills);
      setSubagents(subagents);
      setMarketplaces(marketplaces);
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
    subagents,
    skillEditor,
    busy,
    busySessions,
    marketplaces,
    selectedMarketplaceId,
    marketCatalog,
    marketLoading,
    marketError,
    installingSkill,
    marketOpen,
    filesOpen,
    openMarket: () => setMarketOpen(true),
    closeMarket: () => setMarketOpen(false),
    openFiles: () => setFilesOpen(true),
    closeFiles: () => setFilesOpen(false),
    addMarketplace,
    loadMarketplace,
    removeMarketplace,
    installMarketSkill,
    send,
    loadSession,
    createSession,
    deleteSession,
    resetSession,
    renameSession,
    setMode,
    setThinking,
    toggleSkill,
    openEditSkill,
    openCreateSkill,
    saveSkill,
    removeSkill,
    openFileEditor,
    saveFile,
    uploadFile,
    handleApproval,
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
        busySessionIds={state.busySessions}
        skills={state.skills}
        subagents={state.subagents}
        activeSkills={activeSkills}
        onLoadSession={state.loadSession}
        onCreateSession={state.createSession}
        onDeleteSession={state.deleteSession}
        onRenameSession={state.renameSession}
        onToggleSkill={state.toggleSkill}
        onOpenCreateSkill={state.openCreateSkill}
        onOpenEditSkill={state.openEditSkill}
        onOpenMarket={state.openMarket}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col px-4">
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
          <header className="flex items-center justify-between py-5">
            <div className="flex items-center gap-2.5">
              <div className="btn-primary flex h-8 w-8 items-center justify-center rounded-xl2 text-sm font-bold">A</div>
              <div>
                <h1 className="text-sm font-semibold leading-tight">{state.activeSession?.title ?? "Agent"}</h1>
                <p className="muted text-xs leading-tight">
                  Bun · LangGraph · {(state.activeSession?.mode ?? "build") === "plan" ? "plan" : "build"} · {state.activeSession?.thinking ?? "high"} thinking · {state.activeSession?.activeSkills.length ?? 0} skills enabled
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={state.openFiles} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80">Files</button>
              <button onClick={state.openMarket} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80 md:hidden">Market</button>
              <button onClick={state.openCreateSkill} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80 md:hidden">Add skill</button>
              <button onClick={state.resetSession} className="chip rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-80">Clear messages</button>
            </div>
          </header>

          <main ref={listRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
            {state.messages.length === 0 ? <EmptyState /> : state.messages.map((message) => <Bubble key={message.id} message={message} onApprove={state.handleApproval} />)}
          </main>

          <footer className="sticky bottom-0 pb-5 pt-2" style={{ background: "var(--bg)" }}>
            <Composer
              busy={state.busy}
              mode={state.activeSession?.mode ?? "build"}
              thinking={state.activeSession?.thinking ?? "high"}
              onModeChange={state.setMode}
              onThinkingChange={state.setThinking}
              onSend={state.send}
            />
          </footer>
        </div>
      </div>
      <SkillEditor editor={state.skillEditor} onClose={state.closeSkillEditor} onSave={state.saveSkill} onRemove={state.removeSkill} />
      <SkillMarket
        open={state.marketOpen}
        sources={state.marketplaces}
        catalog={state.marketCatalog}
        selectedId={state.selectedMarketplaceId}
        loading={state.marketLoading}
        error={state.marketError}
        installing={state.installingSkill}
        onClose={state.closeMarket}
        onAdd={state.addMarketplace}
        onSelect={state.loadMarketplace}
        onRemove={state.removeMarketplace}
        onInstall={state.installMarketSkill}
      />
      <FileExplorer
        open={state.filesOpen}
        files={state.files}
        onClose={state.closeFiles}
        onUpload={state.uploadFile}
        onOpenFile={state.openFileEditor}
      />
      <FileEditor editor={state.fileEditor} onClose={state.closeFileEditor} onSave={state.saveFile} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
