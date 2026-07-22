import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Skill } from "../types";

const blank = (): Skill => ({ name: "new-skill", description: "", body: "# Instructions\n\n", enabled: true });
export function SkillsPage({ skills, activeSkills, onSave, onDelete, onToggle }: { skills: Skill[]; activeSkills: string[]; onSave: (skill: Skill) => Promise<void>; onDelete: (name: string) => Promise<void>; onToggle: (name: string, enabled: boolean) => Promise<void> }) {
  const [selected, setSelected] = useState<Skill | null>(skills[0] ?? null);
  const current = selected && (skills.find(s => s.name === selected.name) ?? selected);
  return <main className="page skills-page"><div className="skills-list"><div className="page-header compact"><div><span className="eyebrow">Progressive disclosure</span><h1>Skills</h1></div><button className="icon-button" onClick={() => setSelected(blank())}><Plus /></button></div>
    {skills.map(skill => <div className={`skill-list-row ${current?.name === skill.name ? "active" : ""}`} key={skill.name}>
      <input type="checkbox" title="Enable for current session" checked={activeSkills.includes(skill.name)} onChange={e => onToggle(skill.name, e.target.checked)} />
      <button onClick={() => setSelected(skill)}><strong>{skill.name}</strong><span>{skill.description}</span></button>
    </div>)}</div>
    <div className="skill-editor">{current ? <>
      <div className="page-header compact"><div><span className="eyebrow">SKILL.md</span><h2>{current.name}</h2></div><button className="icon-button danger" onClick={async () => { await onDelete(current.name); setSelected(null); }}><Trash2 /></button></div>
      <label>Name<input value={current.name} onChange={e => setSelected({ ...current, name: e.target.value })} /></label>
      <label>Description<input value={current.description} onChange={e => setSelected({ ...current, description: e.target.value })} /></label>
      <label className="body-field">Instructions<textarea value={current.body} onChange={e => setSelected({ ...current, body: e.target.value })} /></label>
      <button className="primary align-right" onClick={() => onSave(current)}><Save size={16} /> Save skill</button>
    </> : <div className="empty-panel">Select a skill or create a new one.</div>}</div>
  </main>;
}
