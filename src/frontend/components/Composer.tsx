import { useState, useRef } from "react";

interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
}

export function Composer({ busy, onSend }: ComposerProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

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
    <form className="card flex items-end gap-2 rounded-xl2 border p-2 shadow-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder="Send a message…"
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); autoGrow(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        className="field max-h-40 flex-1 resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <button type="submit" disabled={busy} className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">Send</button>
    </form>
  );
}
