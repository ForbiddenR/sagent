import { useEffect, useState } from "react";

interface FileEditorProps {
  editor: { path: string; content: string } | null;
  onClose: () => void;
  onSave: (path: string, content: string) => void;
}

export function FileEditor({ editor, onClose, onSave }: FileEditorProps) {
  const [draft, setDraft] = useState(editor?.content ?? "");

  useEffect(() => {
    setDraft(editor?.content ?? "");
  }, [editor?.path, editor?.content]);

  if (!editor) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl2 border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold font-mono">{editor.path}</h3>
            <p className="muted text-xs">Edit file content</p>
          </div>
          <button onClick={onClose} className="chip rounded-md border px-2 py-1 text-xs">Close</button>
        </div>
        <div className="space-y-3 overflow-auto p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field h-96 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs leading-relaxed outline-none"
          />
          <div className="flex justify-end">
            <button onClick={() => onSave(editor.path, draft)} className="btn-primary rounded-md px-3 py-2 text-xs font-medium">
              Save file
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
