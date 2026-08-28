import { useMemo, useRef, useState } from "react";
import type { SessionSummary, SkillSummary, SubagentSummary } from "../types";
import { formatSessionTime, sessionGroup, type SessionGroup } from "../utils";

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  busySessionIds?: Set<string>;
  skills: SkillSummary[];
  subagents: SubagentSummary[];
  activeSkills: Set<string>;
  onLoadSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onOpenCreateSkill: () => void;
  onOpenEditSkill: (name: string) => void;
  onOpenMarket: () => void;
}

type SidebarPanel = "workspace" | "skills";

const GROUP_LABEL: Record<SessionGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

function groupSessions(sessions: SessionSummary[]) {
  const buckets: Record<SessionGroup, SessionSummary[]> = { today: [], yesterday: [], earlier: [] };
  for (const session of sessions) buckets[sessionGroup(session.updatedAt)].push(session);
  return (["today", "yesterday", "earlier"] as const)
    .map((key) => ({ key, label: GROUP_LABEL[key], sessions: buckets[key] }))
    .filter((group) => group.sessions.length > 0);
}

export function Sidebar({
  sessions,
  activeSessionId,
  busySessionIds,
  skills,
  subagents,
  activeSkills,
  onLoadSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onToggleSkill,
  onOpenCreateSkill,
  onOpenEditSkill,
  onOpenMarket,
}: SidebarProps) {
  const [panel, setPanel] = useState<SidebarPanel>("workspace");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const skipCommit = useRef(false);

  function startRename(session: SessionSummary) {
    skipCommit.current = false;
    setEditingId(session.id);
    setDraft(session.title);
  }

  function commitRename() {
    if (skipCommit.current) {
      skipCommit.current = false;
      setEditingId(null);
      return;
    }
    if (!editingId) return;
    const title = draft.trim();
    const id = editingId;
    setEditingId(null);
    if (title) onRenameSession(id, title);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(q));
  }, [sessions, query]);
  const grouped = useMemo(() => groupSessions(filtered), [filtered]);

  return (
    <aside className="card hidden h-full w-72 shrink-0 flex-col overflow-hidden border-r md:flex">
      <div className="p-3 pb-2">
        <div className="grid grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-100 p-1 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={() => setPanel("workspace")}
            className={`rounded-md px-2 py-1.5 ${panel === "workspace" ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "muted hover:text-zinc-950 dark:hover:text-zinc-50"}`}
          >
            Sessions
          </button>
          <button
            onClick={() => setPanel("skills")}
            className={`rounded-md px-2 py-1.5 ${panel === "skills" ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "muted hover:text-zinc-950 dark:hover:text-zinc-50"}`}
          >
            Skills
          </button>
        </div>
      </div>

      {panel === "workspace" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 px-3 pb-2">
            <button onClick={onCreateSession} className="btn-primary w-full rounded-md px-2 py-1.5 text-xs font-medium">
              New chat
            </button>
            {sessions.length > 4 && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions…"
                className="field w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {filtered.length === 0 ? (
              <p className="muted px-1 py-4 text-center text-xs">
                {query.trim() ? "No sessions match." : "No sessions yet."}
              </p>
            ) : (
              grouped.map((group) => (
                <section key={group.key} className="mb-2">
                  <h2 className="muted sticky top-0 z-10 bg-[var(--card)] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide">
                    {group.label}
                  </h2>
                  <div className="space-y-0.5">
                    {group.sessions.map((session) => {
                      const active = session.id === activeSessionId;
                      const running = busySessionIds?.has(session.id);
                      return (
                        <div
                          key={session.id}
                          className={`group relative rounded-md ${
                            active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                          }`}
                        >
                          {editingId === session.id ? (
                            <div className="px-2 py-1.5">
                              <input
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitRename();
                                  }
                                  if (e.key === "Escape") {
                                    skipCommit.current = true;
                                    setEditingId(null);
                                  }
                                }}
                                className="field w-full rounded border px-1 py-0.5 text-[13px] font-medium leading-tight outline-none"
                              />
                            </div>
                          ) : (
                          <button
                            onClick={() => onLoadSession(session.id)}
                            onDoubleClick={(e) => {
                              e.preventDefault();
                              startRename(session);
                            }}
                            className="w-full px-2 py-1.5 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              {running && (
                                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" title="Running" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight" title="Double-click to rename">
                                {session.title}
                              </span>
                              <span className="muted shrink-0 text-[10px]">{formatSessionTime(session.updatedAt)}</span>
                            </div>
                            <div className="muted mt-0.5 flex items-center gap-1.5 pl-[0.875rem] text-[10px] leading-tight">
                              <span>{session.messageCount} msg{session.messageCount === 1 ? "" : "s"}</span>
                              {session.mode === "plan" && <span>· plan</span>}
                            </div>
                          </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession(session.id);
                            }}
                            title="Delete session"
                            className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded text-[11px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 group-hover:flex dark:hover:bg-zinc-700 dark:hover:text-zinc-50"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      ) : (
        <section className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide muted">Skills</h2>
            <div className="flex gap-1">
              <button onClick={onOpenMarket} className="chip rounded-md border px-2 py-1 text-xs font-medium">Market</button>
              <button onClick={onOpenCreateSkill} className="btn-primary rounded-md px-2 py-1 text-xs font-medium">Add</button>
            </div>
          </div>
          <div className="muted text-xs">{activeSkills.size}/{skills.length} enabled</div>
          {skills.map((skill) => {
            const enabled = activeSkills.has(skill.name);
            return (
              <div key={skill.name} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onToggleSkill(skill.name, e.target.checked)}
                    className="mt-1 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpenEditSkill(skill.name)} className="truncate text-left text-sm font-medium hover:underline">
                      {skill.name}
                    </button>
                    <p className="muted text-xs">{skill.description}</p>
                    {skill.origin && <p className="muted truncate text-[10px]">{skill.origin}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide muted">Subagents</h2>
          <div className="muted text-xs">{subagents.length} type{subagents.length === 1 ? "" : "s"} — spawn via the task tool</div>
          {subagents.map((subagent) => (
            <div key={subagent.name} className="rounded-lg border border-violet-200 p-2 dark:border-violet-800">
              <div className="truncate text-sm font-medium">{subagent.name}</div>
              <p className="muted text-xs">{subagent.description}</p>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
