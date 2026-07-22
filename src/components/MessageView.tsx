import { Check, LoaderCircle, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../types";

export function MessageView({ message }: { message: Message }) {
  return <article className={`message ${message.role}`}>
    <div className="message-role">{message.role === "user" ? "You" : "Dagent"}</div>
    {message.tools.length > 0 && <div className="activity-list">{message.tools.map((tool, i) =>
      <div className="activity" key={`${tool.name}-${i}`}>
        {tool.status === "running" ? <LoaderCircle className="spin" size={14} /> : tool.status === "completed" ? <Check size={14} /> : <X size={14} />}
        <Wrench size={13} /><span>{tool.name}</span>{tool.detail && <small>{tool.detail}</small>}
      </div>)}</div>}
    {message.skills.length > 0 && <div className="skill-chips">{message.skills.map(skill => <span key={skill}>✦ {skill}</span>)}</div>}
    {message.error ? <div className="error-box">{message.error}</div> : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || "Working…"}</ReactMarkdown></div>}
    {(message.inputTokens || message.outputTokens) && <div className="message-usage">↑ {message.inputTokens ?? 0} · ↓ {message.outputTokens ?? 0} tokens</div>}
  </article>;
}
