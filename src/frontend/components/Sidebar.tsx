import { useState } from "react";
import type { SessionFile, SessionSummary, SkillSummary, SubagentSummary } from "../types";
import { formatTime } from "../utils";

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  files: SessionFile[];
  skills: SkillSummary[];
  subagents: SubagentSummary[];
  activeSkills: Set<string>;
  onLoadSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onUploadFile: (file: File) => void;
  onOpenFileEditor: (path: string) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onOpenCreateSkill: () => void;
  onOpenEditSkill: (name: string) => void;
}

type SidebarPanel = "workspace" | "skills";

export function Sidebar({ sessions, activeSessionId, files, skills, subagents, activeSkills, onLoadSession, onCreateSession, onDeleteSession, onUploadFile, onOpenFileEditor, onToggleSkill, onOpenCreateSkill, onOpenEditSkill }: SidebarProps) {
  const [panel, setPanel] = useState<SidebarPanel>("workspace");
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const visibleFiles = files.filter((file) => !file.isDir);

  return (
    <aside className="card hidden h-full w-72 shrink-0 flex-col gap-4 overflow-hidden border-r p-4 md:flex">
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

      {panel === "workspace" ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setSessionsCollapsed((collapsed) => !collapsed)} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide muted hover:text-zinc-950 dark:hover:text-zinc-50">
                <span className="text-[10px]">{sessionsCollapsed ? "▶" : "▼"}</span>
                Sessions
              </button>
              <button onClick={onCreateSession} className="btn-primary rounded-md px-2 py-1 text-xs font-medium">New</button>
            </div>
            {sessionsCollapsed ? (
              <button onClick={() => setSessionsCollapsed(false)} className="chip w-full rounded-md border px-2 py-1.5 text-left text-xs">
                {sessions.length} session{sessions.length === 1 ? "" : "s"} hidden
              </button>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div key={session.id} className={`group rounded-lg border p-2 ${session.id === activeSessionId ? "border-zinc-900 dark:border-zinc-100" : "border-transparent hover:border-zinc-200 dark:hover:border-zinc-800"}`}>
                    <button onClick={() => onLoadSession(session.id)} className="w-full text-left">
                      <div className="truncate text-sm font-medium">{session.title}</div>
                      <div className="muted mt-0.5 text-xs">{session.messageCount} messages · {formatTime(session.updatedAt)}</div>
                    </button>
                    <div className="mt-2 flex gap-2 opacity-70 group-hover:opacity-100">
                      <button onClick={() => onLoadSession(session.id)} className="chip rounded-md border px-2 py-0.5 text-xs">Open</button>
                      <button onClick={() => onDeleteSession(session.id)} className="chip rounded-md border px-2 py-0.5 text-xs">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide muted">Files ({visibleFiles.length})</h2>
            <div className="mb-2">
              <input
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(file);
                  e.target.value = "";
                }}
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-zinc-200 file:px-2 file:py-1 file:text-xs file:font-medium hover:file:bg-zinc-300 dark:file:bg-zinc-700 dark:hover:file:bg-zinc-600"
              />
            </div>
            <div className="space-y-1">
              {visibleFiles.length === 0 ? (
                <p className="muted text-xs">No files yet</p>
              ) : (
                visibleFiles.map((file) => (
                  <button key={file.name} onClick={() => onOpenFileEditor(file.name)} className="w-full rounded border border-zinc-200 p-1.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                    <div className="truncate text-xs font-medium font-mono">{file.name}</div>
                    <div className="muted text-xs">{(file.size / 1024).toFixed(1)} KB</div>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <section className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide muted">Skills</h2>
            <button onClick={onOpenCreateSkill} className="btn-primary rounded-md px-2 py-1 text-xs font-medium">Add</button>
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
