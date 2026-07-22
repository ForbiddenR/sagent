import { Bot, Circle, MessageSquarePlus, Settings, Sparkles, Trash2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { Session, SubagentStatus } from "../types";

interface Props {
  sessions: Session[];
  activeId: string | null;
  contextUsed: number;
  contextMax: number;
  subagents: SubagentStatus[];
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar(props: Props) {
  const percent = Math.min(100, Math.round((props.contextUsed / Math.max(1, props.contextMax)) * 100));
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Bot size={18} /></div><div><strong>Dagent</strong><span>desktop agent</span></div></div>
    <nav className="route-nav">
      <NavLink to="/" end className={({ isActive }) => isActive ? "active" : ""}><Circle size={13} /> Agent</NavLink>
      <NavLink to="/skills" className={({ isActive }) => isActive ? "active" : ""}><Sparkles size={15} /> Skills</NavLink>
      <NavLink to="/settings" className={({ isActive }) => isActive ? "active" : ""}><Settings size={15} /> Settings</NavLink>
    </nav>
    <div className="sidebar-heading"><span>History</span><button title="New session" onClick={props.onNew}><MessageSquarePlus size={16} /></button></div>
    <div className="session-list">
      {props.sessions.map(session => <div className={`session-row ${session.id === props.activeId ? "active" : ""}`} key={session.id}>
        <button className="session-open" onClick={() => props.onSelect(session.id)}>
          <span>{session.title}</span><small>{session.messages.length} messages</small>
        </button>
        <button className="icon-button danger" onClick={() => props.onDelete(session.id)} title="Delete"><Trash2 size={14} /></button>
      </div>)}
    </div>
    <div className="sidebar-status">
      <div className="status-title"><span>Context</span><span>{percent}%</span></div>
      <div className="meter"><i style={{ width: `${percent}%` }} /></div>
      <small>{props.contextUsed.toLocaleString()} / {props.contextMax.toLocaleString()} tokens</small>
      <div className="status-title subagent-title"><span>Subagents</span><span>{props.subagents.filter(x => x.status === "running").length} active</span></div>
      {props.subagents.length === 0 ? <small>No subagents</small> : props.subagents.slice(-3).map(agent =>
        <div className="subagent" key={agent.id}><i className={agent.status} /><span>{agent.task}</span><small>{agent.status}</small></div>)}
    </div>
  </aside>;
}
