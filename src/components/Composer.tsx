import { ArrowUp, Command } from "lucide-react";
import { useMemo, useState } from "react";

const commands: [string, string][] = [
  ["/effort low|medium|high", "Set reasoning effort"],
  ["/model", "Change model"],
  ["/clear", "Clear this session"],
  ["/compact", "Compact older context"],
  ["/usage", "Show context usage"],
  ["/new", "Create a new session"],
  ["/skills", "Open skills"],
  ["/settings", "Open settings"],
];

const commandCompletion = (command: string) => {
  if (command.startsWith("/effort ")) return "/effort ";
  if (command === "/model") return "/model ";
  return command;
};

export function Composer({ busy, effort, model, models, onSend }: { busy: boolean; effort: string; model: string; models: string[]; onSend: (value: string) => void }) {
  const [value, setValue] = useState("");
  const modelQuery = value.startsWith("/model ") ? value.slice("/model ".length).toLowerCase() : null;
  const filtered = useMemo<[string, string][]>(() => {
    if (modelQuery !== null) {
      return models
        .filter(candidate => candidate.toLowerCase().startsWith(modelQuery))
        .map(candidate => [`/model ${candidate}`, candidate === model ? "Current model" : "Available model"]);
    }
    if (!value.startsWith("/") || value.includes(" ")) return [];
    return commands.filter(([command]) => command.startsWith(value.toLowerCase()));
  }, [model, modelQuery, models, value]);
  const showCommands = filtered.length > 0;
  function submit() { const text = value.trim(); if (!text || busy) return; onSend(text); setValue(""); }
  function completeCommand() {
    const match = filtered[0];
    if (match) setValue(commandCompletion(match[0]));
  }
  return <div className="composer-wrap">
    {showCommands && <div className="command-menu">{filtered.map(([command, detail]) =>
      <button key={command} onClick={() => setValue(commandCompletion(command))}><Command size={14} /><strong>{command}</strong><span>{detail}</span></button>)}</div>}
    <div className="composer">
      <textarea value={value} disabled={busy} rows={1} placeholder="Ask Dagent anything, or type / for commands"
        onChange={e => setValue(e.target.value)} onKeyDown={e => {
          if (e.key === "Tab" && showCommands) { e.preventDefault(); completeCommand(); }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }} />
      <div className="composer-footer"><span>Model: {model} · Effort: {effort}</span><span>{showCommands ? "Tab to complete · Enter to send" : "Enter to send · Shift+Enter for newline"}</span><button disabled={busy || !value.trim()} onClick={submit}><ArrowUp size={17} /></button></div>
    </div>
  </div>;
}
