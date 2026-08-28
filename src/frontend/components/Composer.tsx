import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionMode, ThinkingLevel } from "../types";
import { THINKING_LEVELS } from "../types";

interface ComposerProps {
  busy: boolean;
  mode: SessionMode;
  thinking: ThinkingLevel;
  onModeChange: (mode: SessionMode) => void;
  onThinkingChange: (thinking: ThinkingLevel) => void;
  onSend: (text: string) => void;
}

const MODES: { id: SessionMode; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "build",
    label: "Build",
    hint: "Write files and run commands",
    icon: (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2.5 13.5 7 9M9.2 3.2l3.6 3.6M8.4 4l3.6 3.6L8 11.6 4.4 8z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "plan",
    label: "Plan",
    hint: "Read-only · no writes",
    icon: (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
        <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" strokeLinecap="round" />
      </svg>
    ),
  },
];

const THINKING: { id: ThinkingLevel; label: string; hint: string }[] = [
  { id: "low", label: "Low", hint: "Fast replies" },
  { id: "medium", label: "Medium", hint: "Balanced" },
  { id: "high", label: "High", hint: "Default" },
  { id: "xhigh", label: "Extra high", hint: "Deeper reasoning" },
  { id: "max", label: "Max", hint: "No depth cap" },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 opacity-50 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M8 1.4 9.1 5.4 13 6.5 9.1 7.6 8 11.6 6.9 7.6 3 6.5 6.9 5.4z" />
      <path d="M12.2 9.6 12.7 11.4 14.5 11.9 12.7 12.4 12.2 14.2 11.7 12.4 9.9 11.9 11.7 11.4z" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 6.2 4.8 9 10 3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Menu({
  open,
  onClose,
  children,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`card absolute bottom-[calc(100%+6px)] z-30 min-w-[13.5rem] overflow-hidden rounded-xl border py-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
    >
      {children}
    </div>
  );
}

function MenuItem({
  selected,
  label,
  hint,
  icon,
  onSelect,
}: {
  selected: boolean;
  label: string;
  hint: string;
  icon?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        selected ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-400"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{selected ? <Check /> : icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-tight">{label}</span>
        <span className="muted block text-[11px] font-normal leading-tight">{hint}</span>
      </span>
    </button>
  );
}

function Chip({
  open,
  onClick,
  icon,
  label,
  accent,
}: {
  open: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors ${
        accent
          ? "bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      }`}
    >
      <span className="opacity-80">{icon}</span>
      {label}
      <Chevron open={open} />
    </button>
  );
}

export function Composer({ busy, mode, thinking, onModeChange, onThinkingChange, onSend }: ComposerProps) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState<"mode" | "thinking" | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const plan = mode === "plan";
  const currentMode = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const currentThinking = THINKING.find((t) => t.id === thinking) ?? THINKING[2]!;

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
    setOpen(null);
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  }

  return (
    <form className="card flex flex-col gap-1.5 rounded-2xl border p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={plan ? "Describe what to plan…" : "Send a message…"}
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); autoGrow(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="field max-h-40 w-full resize-none rounded-xl bg-transparent px-2.5 py-2 text-sm outline-none"
      />
      <div className="flex items-center gap-1.5 px-0.5">
        <div className="relative">
          <Chip
            open={open === "mode"}
            onClick={() => setOpen(open === "mode" ? null : "mode")}
            icon={currentMode.icon}
            label={currentMode.label}
            accent={plan}
          />
          <Menu open={open === "mode"} onClose={() => setOpen(null)}>
            {MODES.map((option) => (
              <MenuItem
                key={option.id}
                selected={mode === option.id}
                label={option.label}
                hint={option.hint}
                icon={option.icon}
                onSelect={() => {
                  onModeChange(option.id);
                  setOpen(null);
                }}
              />
            ))}
          </Menu>
        </div>

        <div className="relative">
          <Chip
            open={open === "thinking"}
            onClick={() => setOpen(open === "thinking" ? null : "thinking")}
            icon={<Sparkle />}
            label={currentThinking.label}
          />
          <Menu open={open === "thinking"} onClose={() => setOpen(null)}>
            <div className="muted px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide">Thinking</div>
            {THINKING.map((option) => (
              <MenuItem
                key={option.id}
                selected={thinking === option.id}
                label={option.label}
                hint={option.hint}
                onSelect={() => {
                  onThinkingChange(option.id);
                  setOpen(null);
                }}
              />
            ))}
          </Menu>
        </div>

        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Send"
          className="btn-primary ml-auto flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M8 12.5V3.5M4.2 7.2 8 3.5l3.8 3.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  );
}
