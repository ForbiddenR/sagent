import { Bot, Check, CircleDashed, Gauge, Layers3, LoaderCircle, Sparkles, Wrench, X } from "lucide-react";
import type { Session, SubagentStatus, ToolActivity } from "../types";

interface Props {
  session?: Session;
  busy: boolean;
  contextUsed: number;
  contextMax: number;
  subagents: SubagentStatus[];
}

const statusIcon = (status: ToolActivity["status"]) => status === "running"
  ? <LoaderCircle className="spin" size={13} />
  : status === "completed" ? <Check size={13} /> : <X size={13} />;

export function WorkspaceInspector({ session, busy, contextUsed, contextMax, subagents }: Props) {
  const percent = Math.min(100, Math.round((contextUsed / Math.max(1, contextMax)) * 100));
  const tools = (session?.messages.flatMap(message => message.tools) ?? []).slice(-6).reverse();
  const runningAgents = subagents.filter(agent => agent.status === "running").length;
  return <aside className="workspace-inspector">
    <div className="inspector-heading"><div><span className="eyebrow">Live workspace</span><h2>Run overview</h2></div><span className={`run-badge ${busy ? "running" : ""}`}><i />{busy ? "Running" : "Ready"}</span></div>

    <section className="inspector-card">
      <div className="inspector-card-title"><span><Gauge size={14} /> Context</span><strong>{percent}%</strong></div>
      <div className="context-meter"><i style={{ width: `${percent}%` }} /></div>
      <div className="metric-row"><span>{contextUsed.toLocaleString()} used</span><span>{contextMax.toLocaleString()} max</span></div>
    </section>

    <section className="inspector-card">
      <div className="inspector-card-title"><span><Wrench size={14} /> Tool activity</span><small>{tools.length}</small></div>
      <div className="inspector-list">
        {tools.length === 0 ? <div className="inspector-empty">No tool calls in this session</div> : tools.map((tool, index) =>
          <div className="inspector-item" key={`${tool.name}-${index}`}><span className={`status-icon ${tool.status}`}>{statusIcon(tool.status)}</span><div><strong>{tool.name}</strong><small>{tool.detail || tool.status}</small></div></div>)}
      </div>
    </section>

    <section className="inspector-card">
      <div className="inspector-card-title"><span><Sparkles size={14} /> Active skills</span><small>{session?.activeSkills.length ?? 0}</small></div>
      <div className="inspector-chips">{session?.activeSkills.length ? session.activeSkills.map(skill => <span key={skill}>{skill}</span>) : <div className="inspector-empty">No skills enabled</div>}</div>
    </section>

    <section className="inspector-card inspector-grow">
      <div className="inspector-card-title"><span><Bot size={14} /> Subagents</span><small>{runningAgents} active</small></div>
      <div className="inspector-list">
        {subagents.length === 0 ? <div className="inspector-empty">No delegated tasks</div> : subagents.slice(-6).reverse().map(agent =>
          <div className="inspector-item" key={agent.id}><span className={`agent-dot ${agent.status}`} /> <div><strong>{agent.task}</strong><small>{agent.status}</small></div></div>)}
      </div>
    </section>

    <section className="session-summary">
      <div><Layers3 size={14} /><span>Messages</span><strong>{session?.messages.length ?? 0}</strong></div>
      <div><CircleDashed size={14} /><span>Compacted</span><strong>{session?.compactedTokens.toLocaleString() ?? 0}</strong></div>
    </section>
  </aside>;
}
