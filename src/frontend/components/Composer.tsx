import { useState, useRef } from "react";
import type { SessionMode } from "../types";

interface ComposerProps {
  busy: boolean;
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  onSend: (text: string) => void;
}

export function Composer({ busy, mode, onModeChange, onSend }: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const plan = mode === "plan";

  function autoGrow() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <form className="card flex flex-col gap-2 rounded-xl2 border p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={plan ? "Describe what to plan… (read-only)" : "Send a message…"}
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); autoGrow(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        className="field max-h-40 w-full resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <div className="flex items-center gap-2">
        <div className="grid grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900">
          {(["build", "plan"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              className={`rounded-md px-2.5 py-1 ${
                mode === option
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "muted hover:text-zinc-950 dark:hover:text-zinc-50"
              }`}
            >
              {option === "build" ? "Build" : "Plan"}
            </button>
          ))}
        </div>
        {plan && <span className="muted text-[11px]">read-only · no writes</span>}
        <button type="submit" disabled={busy} className="btn-primary ml-auto rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">Send</button>
      </div>
    </form>
  );
}
