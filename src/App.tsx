import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api";
import { Composer } from "./components/Composer";
import { MessageView } from "./components/MessageView";
import { Sidebar } from "./components/Sidebar";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import type { ChatEvent, Message, Session, Settings, Skill, SubagentStatus } from "./types";

const defaults: Settings = { apiKey: "", baseUrl: "", providerFormat: "openai", model: "gpt-5-mini", theme: "system", maxContextSize: 128000, effort: "medium" };
const tokenCount = (session?: Session) => session?.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0) ?? 0;

export default function App() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(defaults); const [sessions, setSessions] = useState<Session[]>([]); const [skills, setSkills] = useState<Skill[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [subagents, setSubagents] = useState<SubagentStatus[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null); const active = sessions.find(s => s.id === activeId);
  const contextUsed = useMemo(() => tokenCount(active), [active]);
  const replaceSession = (session: Session) => setSessions(current => [session, ...current.filter(s => s.id !== session.id)].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));

  useEffect(() => {
    void (async () => {
      try {
        const [config, history, loadedSkills] = await Promise.all([api.settings(), api.sessions(), api.skills()]);
        setSettings(config);
        setSessions(history);
        setSkills(loadedSkills);
        if (history[0]) setActiveId(history[0].id);
        else {
          const session = await api.createSession();
          setSessions([session]);
          setActiveId(session.id);
        }
      } catch (error) {
        console.error("Dagent initialization failed", error);
        setStartupError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);
  useEffect(() => { const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [settings.theme]);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [active?.messages, busy]);

  async function createSession() { const session = await api.createSession(); replaceSession(session); setActiveId(session.id); navigate("/"); }
  async function runCommand(text: string) {
    const [command, arg] = text.slice(1).split(/\s+/, 2);
    if (command === "new") return createSession();
    if (command === "settings" || command === "skills") { navigate(`/${command}`); return; }
    if (!activeId) return;
    if (command === "clear") return replaceSession(await api.clearSession(activeId));
    if (command === "compact") return replaceSession(await api.compactSession(activeId));
    if (command === "effort" && ["low", "medium", "high"].includes(arg)) { const next = { ...settings, effort: arg as Settings["effort"] }; setSettings(await api.saveSettings(next)); return; }
    if (command === "usage") { const msg: Message = { id: crypto.randomUUID(), role: "assistant", content: `Context usage: **${contextUsed.toLocaleString()} / ${settings.maxContextSize.toLocaleString()} tokens** (${Math.round(contextUsed/settings.maxContextSize*100)}%).`, createdAt: new Date().toISOString(), tools: [], skills: [] }; if (active) replaceSession({ ...active, messages: [...active.messages, msg] }); return; }
  }
  async function send(text: string) {
    if (text.startsWith("/")) return runCommand(text);
    if (!activeId || busy) return;
    const user: Message = { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString(), tools: [], skills: [] };
    const pending: Message = { id: `pending-${Date.now()}`, role: "assistant", content: "", createdAt: new Date().toISOString(), tools: [], skills: [] };
    if (active) replaceSession({ ...active, messages: [...active.messages, user, pending] }); setBusy(true);
    const updatePending = (fn: (message: Message) => Message) => setSessions(current => current.map(session => session.id !== activeId ? session : ({ ...session, messages: session.messages.map(m => m.id === pending.id ? fn(m) : m) })));
    try { await api.chat(activeId, text, (event: ChatEvent) => {
      if (event.type === "tool_started") updatePending(m => ({ ...m, tools: [...m.tools, { name: event.name, detail: event.detail, status: "running" }] }));
      if (event.type === "tool_finished") updatePending(m => ({ ...m, tools: m.tools.map((t, i, all) => i === all.map(x => x.name).lastIndexOf(event.name) ? { ...t, status: event.success ? "completed" : "failed" } : t) }));
      if (event.type === "skill") updatePending(m => ({ ...m, skills: [...new Set([...m.skills, event.name])] }));
      if (event.type === "subagent") setSubagents(current => [...current.filter(a => a.id !== event.id), { id: event.id, task: event.task, status: event.status }]);
      if (event.type === "usage") updatePending(m => ({ ...m, inputTokens: event.inputTokens, outputTokens: event.outputTokens }));
      if (event.type === "done") setSessions(current => current.map(s => s.id === activeId ? { ...s, messages: [...s.messages.filter(m => m.id !== pending.id), event.message], updatedAt: new Date().toISOString() } : s));
      if (event.type === "error") updatePending(m => ({ ...m, error: event.message }));
    }); } catch (error) { updatePending(m => ({ ...m, error: String(error) })); } finally { setBusy(false); const latest = await api.sessions(); setSessions(latest); }
  }

  if (startupError) return <div className="fatal-screen"><div className="fatal-card"><span className="eyebrow">Initialization error</span><h1>Dagent could not start</h1><p>{startupError}</p><button onClick={() => window.location.reload()}>Try again</button></div></div>;

  return <div className="app-shell"><Sidebar sessions={sessions} activeId={activeId} contextUsed={contextUsed} contextMax={settings.maxContextSize} subagents={subagents} onNew={createSession} onSelect={id => { setActiveId(id); navigate("/"); }} onDelete={async id => { await api.deleteSession(id); const next = sessions.filter(s => s.id !== id); setSessions(next); if (activeId === id) setActiveId(next[0]?.id ?? null); }} />
    <Routes>
      <Route path="/" element={<main className="chat-page"><header className="chat-header"><div><span className="eyebrow">Session</span><h1>{active?.title ?? "New session"}</h1></div><div className={`live-state ${busy ? "busy" : ""}`}><i />{busy ? "Agent working" : "Ready"}</div></header><section className="messages">{!active?.messages.length && <div className="welcome"><span>✦</span><h2>What are we working on?</h2><p>Dagent can use tools, load skills, and delegate focused tasks to subagents.</p></div>}{active?.messages.map(message => <MessageView key={message.id} message={message} />)}<div ref={bottomRef} /></section><Composer busy={busy} effort={settings.effort} onSend={send} /></main>} />
      <Route path="/skills" element={<SkillsPage skills={skills} activeSkills={active?.activeSkills ?? []} onSave={async skill => { const saved = await api.saveSkill(skill); setSkills(await api.skills()); return void saved; }} onDelete={async name => { await api.deleteSkill(name); setSkills(await api.skills()); }} onToggle={async (name, enabled) => { if (activeId) replaceSession(await api.toggleSkill(activeId, name, enabled)); }} />} />
      <Route path="/settings" element={<SettingsPage settings={settings} onSave={async next => { setSettings(await api.saveSettings(next)); }} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </div>;
}
