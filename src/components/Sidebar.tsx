import { Bot, Circle, MessageSquarePlus, Settings, Sparkles, Trash2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { Session } from "../types";

interface Props {
  sessions: Session[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar(props: Props) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Bot size={18} /></div><div><strong>Dagent</strong><span>Agent workspace</span></div></div>
    <button className="new-session-button" onClick={props.onNew}><MessageSquarePlus size={15} /><span>New session</span><kbd>Ctrl N</kbd></button>
    <span className="nav-label">Workspace</span>
    <nav className="route-nav">
      <NavLink to="/" end className={({ isActive }) => isActive ? "active" : ""}><Circle size={13} /> Agent</NavLink>
      <NavLink to="/skills" className={({ isActive }) => isActive ? "active" : ""}><Sparkles size={15} /> Skills</NavLink>
      <NavLink to="/settings" className={({ isActive }) => isActive ? "active" : ""}><Settings size={15} /> Settings</NavLink>
    </nav>
    <div className="sidebar-heading"><span>Recent sessions</span><small>{props.sessions.length}</small></div>
    <div className="session-list">
      {props.sessions.map(session => <div className={`session-row ${session.id === props.activeId ? "active" : ""}`} key={session.id}>
        <button className="session-open" onClick={() => props.onSelect(session.id)}>
          <span>{session.title}</span><small>{session.messages.length} messages · {new Date(session.updatedAt).toLocaleDateString()}</small>
        </button>
        <button className="icon-button danger" onClick={() => props.onDelete(session.id)} title="Delete"><Trash2 size={14} /></button>
      </div>)}
    </div>
    <div className="sidebar-footer"><i /><span>Local workspace</span><small>config.toml</small></div>
  </aside>;
}
