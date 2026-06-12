import { useEffect, useState } from "react";
import type { Skill, SkillEditorState } from "../types";
import { blankSkill } from "../utils";

interface SkillEditorProps {
  editor: SkillEditorState;
  onClose: () => void;
  onSave: (skill: Skill, mode: "create" | "edit") => void;
  onRemove: (name: string) => void;
}

export function SkillEditor({ editor, onClose, onSave, onRemove }: SkillEditorProps) {
  const [draft, setDraft] = useState<Skill>(editor?.skill ?? blankSkill());

  useEffect(() => {
    setDraft(editor?.skill ?? blankSkill());
  }, [editor?.skill.name, editor?.skill.description, editor?.skill.body, editor?.mode]);

  if (!editor) return null;
  const isEdit = editor.mode === "edit";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl2 border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold">{isEdit ? "Edit skill" : "Add skill"}</h3>
            <p className="muted text-xs">Skills are saved as <code>skills/&lt;name&gt;/SKILL.md</code>.</p>
          </div>
          <button onClick={onClose} className="chip rounded-md border px-2 py-1 text-xs">Close</button>
        </div>
        <div className="space-y-3 overflow-auto p-4">
          <label className="block text-xs font-medium">
            Name
            <input
              value={draft.name}
              disabled={isEdit}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="field mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="my-skill"
            />
          </label>
          <label className="block text-xs font-medium">
            Description
            <input
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="field mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
              placeholder="One-line description"
            />
          </label>
          <label className="block text-xs font-medium">
            Instructions
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              className="field mt-1 h-72 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none"
            />
          </label>
          <div className="flex justify-between gap-2">
            <div>
              {isEdit && (
                <button onClick={() => onRemove(draft.name)} className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50">
                  Delete skill
                </button>
              )}
            </div>
            <button onClick={() => onSave(draft, editor.mode)} className="btn-primary rounded-md px-3 py-2 text-xs font-medium">
              Save skill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
