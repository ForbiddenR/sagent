import { useEffect, useRef, useState } from "react";
import type { Message, PendingApproval, SubagentRun, SubagentStep } from "../types";
import { MarkdownMessage } from "./Markdown";

function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";

  const [key, value] = entries[0]!;
  const str = String(value);
  return str.length > 40 ? `${str.slice(0, 40)}...` : str;
}

function ToolChip({ name, args }: { name: string; args?: Record<string, unknown> }) {
  const argsPreview = formatToolArgs(args);

  return (
    <div className="flex w-full items-center gap-1.5 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      <span className="text-[10px]">🔧</span>
      <span className="font-medium">{name}</span>
      {argsPreview && (
        <>
          <span className="text-zinc-400 dark:text-zinc-500">(</span>
          <span className="text-zinc-600 dark:text-zinc-400">{argsPreview}</span>
          <span className="text-zinc-400 dark:text-zinc-500">)</span>
        </>
      )}
    </div>
  );
}

function SkillChip({ name }: { name: string }) {
  return (
    <div className="flex w-full items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
      <span className="text-[10px]">📘</span>
      {name}
    </div>
  );
}

function fallbackSteps(run: SubagentRun): SubagentStep[] {
  if ((run.steps ?? []).length > 0) return run.steps!;
  const steps: SubagentStep[] = [];
  for (const name of run.skills) steps.push({ type: "skill", name });
  for (const detail of run.tools) {
    steps.push({ type: "tool", name: String(detail.name ?? "tool"), args: detail.args as Record<string, unknown> | undefined });
  }
  if (run.text) steps.push({ type: "text", text: run.text });
  return steps;
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const steps = fallbackSteps(run);
  const toolCount = run.tools.length + run.skills.length;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, steps, run.text, run.done]);

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-xs text-violet-900 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left font-medium"
      >
        <span className="w-3 shrink-0 text-[10px] text-violet-500">{open ? "▼" : "▶"}</span>
        <span className="text-[10px]">🤖</span>
        <span>{run.name}</span>
        {run.description && (
          <span className="truncate font-normal text-violet-700 dark:text-violet-300">· {run.description}</span>
        )}
        <span className={`ml-auto shrink-0 text-[10px] uppercase tracking-wide ${run.done ? "" : "animate-pulse"}`}>
          {run.done ? "done" : "running"}
          {toolCount > 0 ? ` · ${toolCount}` : ""}
        </span>
      </button>
      {open && (
        <>
          {run.prompt && (
            <div className="whitespace-pre-wrap rounded bg-black/5 px-2 py-1 text-[11px] leading-relaxed text-violet-800 dark:bg-white/10 dark:text-violet-200">
              <span className="font-medium">task </span>
              {run.prompt}
            </div>
          )}
          <div ref={logRef} className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {steps.map((step, i) => {
              if (step.type === "skill") return <SkillChip key={`step-${i}`} name={step.name} />;
              if (step.type === "tool") return <ToolChip key={`step-${i}`} name={step.name} args={step.args} />;
              return (
                <div key={`step-${i}`} className="whitespace-pre-wrap rounded bg-black/5 px-2 py-1 text-[11px] leading-relaxed dark:bg-white/10">
                  {step.text}
                </div>
              );
            })}
            {!run.done && steps.length === 0 && (
              <div className="muted animate-pulse px-1 text-[11px]">thinking...</div>
            )}
          </div>
        </>
      )}
    </div>
  );
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
    <div className="flex flex-col items-start gap-2">
      {((message.skills ?? []).length > 0 || (message.toolDetails ?? []).length > 0 || (message.subagents ?? []).length > 0) && (
        <div className="flex max-w-[85%] flex-col gap-1.5">
          {(message.skills ?? []).map((name, i) => <SkillChip key={`skill-${i}`} name={name} />)}
          {(message.toolDetails ?? []).map((detail, i) => <ToolChip key={`tool-${i}`} name={detail.name as string} args={detail.args as Record<string, unknown>} />)}
          {(message.subagents ?? []).map((run) => <SubagentCard key={run.id} run={run} />)}
        </div>
      )}
      {(message.pendingApprovals ?? []).map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onApprove={onApprove} />
      ))}
      {(message.text || (!message.completed && (message.subagents ?? []).length === 0)) && (
        <div className="bubble-assistant max-w-[85%] rounded-xl2 px-4 py-2.5 text-sm leading-relaxed">
          {message.text && <MarkdownMessage text={message.text} />}
          {message.completed && !message.error && !message.timeout && <div className="muted mt-2 text-xs">response completed ✓</div>}
          {!message.completed && !message.error && !message.timeout && <div className="muted mt-2 text-xs animate-pulse">thinking...</div>}
        </div>
      )}
      {message.error && !message.timeout && <div className="max-w-[85%] rounded-xl2 border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">Error: {message.error}</div>}
      {message.timeout && (
        <div className="max-w-[85%] rounded-xl2 border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          <div className="font-medium">⏱ Request timed out</div>
          <div className="mt-1 text-xs">{message.error}</div>
        </div>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="muted flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm">Ask me anything.</p>
      <p className="text-xs">Try "what is 1234 × 9?", "write me a haiku about the sea", or "use explore to search the web for LangGraph 1.x".</p>
    </div>
  );
}
