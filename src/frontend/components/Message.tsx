import type { Message, PendingApproval } from "../types";
import { MarkdownMessage } from "./Markdown";

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

function ApprovalCard({ approval, onApprove }: { approval: PendingApproval; onApprove: (id: string, approved: boolean) => void }) {
  const command = typeof approval.args?.command === "string" ? approval.args.command : "(no command)";
  return (
    <div className="flex w-fit max-w-[85%] flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
      <div className="font-medium">Approve terminal command?</div>
      <code className="max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-black/5 px-2 py-1 font-mono text-[11px] dark:bg-white/10">
        {command}
      </code>
      <div className="flex gap-2">
        <button onClick={() => onApprove(approval.id, true)} className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">
          Approve
        </button>
        <button onClick={() => onApprove(approval.id, false)} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700">
          Deny
        </button>
      </div>
    </div>
  );
}

interface BubbleProps {
  message: Message;
  onApprove: (id: string, approved: boolean) => void;
}

export function Bubble({ message, onApprove }: BubbleProps) {
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
      {message.pendingApproval && <ApprovalCard approval={message.pendingApproval} onApprove={onApprove} />}
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

export function EmptyState() {
  return (
    <div className="muted flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm">Ask me anything.</p>
      <p className="text-xs">Try "what is 1234 × 9?" or "write me a haiku about the sea".</p>
    </div>
  );
}
