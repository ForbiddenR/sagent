import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { Settings } from "../types";

export function SettingsPage({ settings, onSave }: { settings: Settings; onSave: (settings: Settings) => Promise<void> }) {
  const [form, setForm] = useState(settings); const [saved, setSaved] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm(current => ({ ...current, [key]: value }));
  return <main className="page scroll"><div className="page-header"><div><span className="eyebrow">Configuration</span><h1>Settings</h1><p>Stored locally as TOML in the application config directory.</p></div></div>
    <section className="settings-card">
      <label>Provider format<select value={form.providerFormat} onChange={e => update("providerFormat", e.target.value as Settings["providerFormat"])}><option value="openai">OpenAI compatible</option><option value="anthropic">Anthropic compatible</option></select></label>
      <label>API key<input type="password" value={form.apiKey} onChange={e => update("apiKey", e.target.value)} placeholder="sk-…" /></label>
      <label>Base URL<input value={form.baseUrl} onChange={e => update("baseUrl", e.target.value)} placeholder={form.providerFormat === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com"} /></label>
      <label>Model<input value={form.model} onChange={e => update("model", e.target.value)} placeholder={form.providerFormat === "openai" ? "gpt-5" : "claude-sonnet-4-5"} /></label>
      <div className="settings-grid">
        <label>Theme<select value={form.theme} onChange={e => update("theme", e.target.value as Settings["theme"])}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label>Default effort<select value={form.effort} onChange={e => update("effort", e.target.value as Settings["effort"])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
      <label>Maximum context size <span>{form.maxContextSize.toLocaleString()} tokens</span><input type="range" min="8000" max="200000" step="1000" value={form.maxContextSize} onChange={e => update("maxContextSize", Number(e.target.value))} /></label>
      <div className="settings-actions"><small>{saved ? "Saved to config.toml" : "Changes are local to this device."}</small><button className="primary" onClick={async () => { await onSave(form); setSaved(true); setTimeout(() => setSaved(false), 2000); }}><Save size={16} /> Save settings</button></div>
    </section>
  </main>;
}
