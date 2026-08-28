import { useMemo, useState } from "react";
import type { CatalogSkill, MarketplaceSource } from "../types";

interface SkillMarketProps {
  open: boolean;
  sources: MarketplaceSource[];
  catalog: CatalogSkill[] | null;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  installing: string | null;
  onClose: () => void;
  onAdd: (address: string) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onInstall: (name: string) => void;
}

export function SkillMarket({
  open,
  sources,
  catalog,
  selectedId,
  loading,
  error,
  installing,
  onClose,
  onAdd,
  onSelect,
  onRemove,
  onInstall,
}: SkillMarketProps) {
  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const selected = sources.find((s) => s.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const list = catalog ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(q));
  }, [catalog, query]);

  if (!open) return null;

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const value = address.trim();
    if (!value) return;
    onAdd(value);
    setAddress("");
    setQuery("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card flex h-[min(40rem,90vh)] w-full max-w-5xl overflow-hidden rounded-xl2 border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold">Sources</h3>
            <p className="muted mt-1 text-[11px] leading-relaxed">
              <code>owner/repo</code>, git URL, or <code>marketplace.json</code>
            </p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-1.5">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="anthropics/skills"
              className="field w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
            />
            <button type="submit" className="btn-primary rounded-md px-2 py-1.5 text-xs font-medium">
              Add source
            </button>
          </form>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sources.length === 0 ? (
              <p className="muted text-xs">No sources yet.</p>
            ) : (
              sources.map((source) => (
                <div
                  key={source.id}
                  className={`rounded-lg border p-2 ${
                    source.id === selectedId
                      ? "border-zinc-900 dark:border-zinc-100"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <button onClick={() => onSelect(source.id)} className="w-full text-left">
                    <div className="truncate text-sm font-medium">{source.label}</div>
                    <div className="muted mt-0.5 truncate text-[11px]">{source.address}</div>
                  </button>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="muted text-[10px] uppercase tracking-wide">{source.kind}</span>
                    <button onClick={() => onRemove(source.id)} className="chip rounded-md border px-1.5 py-0.5 text-[10px]">
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{selected ? selected.label : "Skill market"}</h3>
              <p className="muted mt-0.5 text-xs">
                {selected
                  ? loading
                    ? "Loading catalog…"
                    : `${catalog?.length ?? 0} skill${(catalog?.length ?? 0) === 1 ? "" : "s"}`
                  : "Add a source on the left, then install skills from its catalog."}
              </p>
            </div>
            <button onClick={onClose} className="chip shrink-0 rounded-md border px-2 py-1 text-xs">Close</button>
          </div>

          {selected && (
            <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter skills…"
                className="field w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {!selected && <p className="muted text-sm">Pick a source to browse its skills.</p>}
            {selected && loading && <p className="muted animate-pulse text-sm">loading…</p>}
            {selected && !loading && catalog && catalog.length === 0 && (
              <p className="muted text-sm">No SKILL.md files found in this source.</p>
            )}
            {selected && !loading && catalog && catalog.length > 0 && visible.length === 0 && (
              <p className="muted text-sm">No skills match “{query}”.</p>
            )}
            {selected && !loading && visible.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visible.map((skill) => (
                  <div key={skill.path} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{skill.name}</div>
                      <p className="muted mt-1 line-clamp-3 text-xs leading-relaxed">{skill.description}</p>
                    </div>
                    <div className="mt-auto flex items-center justify-end">
                      {skill.installed ? (
                        <span className="muted text-[10px] uppercase tracking-wide">installed</span>
                      ) : (
                        <button
                          disabled={installing === skill.name}
                          onClick={() => onInstall(skill.name)}
                          className="btn-primary rounded-md px-2.5 py-1 text-[11px] font-medium disabled:opacity-40"
                        >
                          {installing === skill.name ? "Installing…" : "Install"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
