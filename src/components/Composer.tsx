import { ArrowUp, Command } from "lucide-react";
import { useMemo, useState } from "react";

const commands = [
  ["/effort low|medium|high", "Set reasoning effort"],
  ["/clear", "Clear this session"],
  ["/compact", "Compact older context"],
  ["/usage", "Show context usage"],
  ["/new", "Create a new session"],
  ["/skills", "Open skills"],
  ["/settings", "Open settings"],
];

export function Composer({ busy, effort, onSend }: { busy: boolean; effort: string; onSend: (value: string) => void }) {
  const [value, setValue] = useState("");
  const showCommands = value.startsWith("/") && !value.includes(" ");
  const filtered = useMemo(() => commands.filter(([command]) => command.startsWith(value.toLowerCase())), [value]);
  function submit() { const text = value.trim(); if (!text || busy) return; onSend(text); setValue(""); }
  return <div className="composer-wrap">
    {showCommands && filtered.length > 0 && <div className="command-menu">{filtered.map(([command, detail]) =>
      <button key={command} onClick={() => setValue(command.split(" ")[0] === "/effort" ? "/effort " : command)}><Command size={14} /><strong>{command}</strong><span>{detail}</span></button>)}</div>}
    <div className="composer">
      <textarea value={value} disabled={busy} rows={1} placeholder="Ask Dagent anything, or type / for commands"
        onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
      <div className="composer-footer"><span>Effort: {effort}</span><span>Enter to send · Shift+Enter for newline</span><button disabled={busy || !value.trim()} onClick={submit}><ArrowUp size={17} /></button></div>
    </div>
  </div>;
}
