import { useMemo, useState } from "react";
import type { SessionFile } from "../types";
import { formatFileSize } from "../utils";

interface FileExplorerProps {
  open: boolean;
  files: SessionFile[];
  onClose: () => void;
  onUpload: (file: File) => void;
  onOpenFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: string;
  children: TreeNode[];
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function parentPath(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function sortNodes(list: TreeNode[]) {
  list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of list) if (child.isDir) sortNodes(child.children);
}

function buildTree(files: SessionFile[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  function ensureDir(path: string): TreeNode {
    const existing = nodes.get(path);
    if (existing) return existing;
    const node: TreeNode = { name: fileName(path) || path, path, isDir: true, size: 0, children: [] };
    nodes.set(path, node);
    const parent = parentPath(path);
    if (parent) ensureDir(parent).children.push(node);
    else roots.push(node);
    return node;
  }

  for (const file of files) {
    if (file.isDir) {
      const node = ensureDir(file.name);
      node.size = file.size;
      node.modified = file.modified;
      continue;
    }
    const node: TreeNode = {
      name: fileName(file.name),
      path: file.name,
      isDir: false,
      size: file.size,
      modified: file.modified,
      children: [],
    };
    nodes.set(file.name, node);
    const parent = parentPath(file.name);
    if (parent) ensureDir(parent).children.push(node);
    else roots.push(node);
  }

  sortNodes(roots);
  return roots;
}

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const hit = findNode(node.children, path);
    if (hit) return hit;
  }
}

function formatModified(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function TreeRows({
  nodes,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selected: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const open = node.isDir && !collapsed.has(node.path);
        const active = selected === node.path;
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onSelect(node)}
              className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[12px] ${
                active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              {node.isDir ? (
                <span
                  className="muted w-3 shrink-0 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(node.path);
                  }}
                >
                  {open ? "▾" : "▸"}
                </span>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <span className="w-4 shrink-0 text-[11px]" aria-hidden>
                {node.isDir ? "📁" : "📄"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
              {!node.isDir && <span className="muted shrink-0 text-[10px]">{formatFileSize(node.size)}</span>}
            </button>
            {open && node.children.length > 0 && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                selected={selected}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
            {open && node.children.length === 0 && (
              <div className="muted py-0.5 pr-2 text-[11px]" style={{ paddingLeft: `${26 + (depth + 1) * 14}px` }}>
                empty
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function FileExplorer({ open, files, onClose, onUpload, onOpenFile }: FileExplorerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildTree(files), [files]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => file.name.toLowerCase().includes(q));
  }, [files, query]);
  const visibleTree = useMemo(() => (query.trim() ? buildTree(filtered) : tree), [query, filtered, tree]);
  const selectedNode = selected ? findNode(tree, selected) : undefined;
  const fileCount = files.filter((file) => !file.isDir).length;
  const folderCount = files.filter((file) => file.isDir).length;

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function select(node: TreeNode) {
    setSelected(node.path);
    if (node.isDir) {
      setCollapsed((prev) => {
        if (!prev.has(node.path)) return prev;
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card flex h-[min(32rem,85vh)] w-full max-w-3xl overflow-hidden rounded-xl2 border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Workspace</h3>
              <span className="muted text-[10px]">
                {fileCount} file{fileCount === 1 ? "" : "s"}
                {folderCount > 0 ? ` · ${folderCount} folder${folderCount === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter paths…"
              className="field mt-2 w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleTree.length === 0 ? (
              <p className="muted px-1 py-6 text-center text-xs">
                {query.trim() ? "No paths match." : "Workspace is empty."}
              </p>
            ) : (
              <TreeRows
                nodes={visibleTree}
                depth={0}
                selected={selected}
                collapsed={query.trim() ? new Set() : collapsed}
                onToggle={toggle}
                onSelect={select}
              />
            )}
          </div>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <label className="chip flex cursor-pointer items-center justify-center rounded-md border px-2 py-1.5 text-xs font-medium hover:opacity-80">
              Upload file
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
            <div className="min-w-0">
              <h3 className="truncate font-mono text-sm font-semibold">{selectedNode?.path ?? "Files"}</h3>
              <p className="muted mt-0.5 text-xs">
                {selectedNode
                  ? selectedNode.isDir
                    ? "Folder in this session workspace"
                    : `${formatFileSize(selectedNode.size)} · ${formatModified(selectedNode.modified)}`
                  : "Select a file or folder to inspect it."}
              </p>
            </div>
            <button onClick={onClose} className="chip shrink-0 rounded-md border px-2 py-1 text-xs">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {!selectedNode && (
              <p className="muted text-sm">
                {fileCount === 0
                  ? "Upload a file or let the agent write one, then browse the tree on the left."
                  : "Click a folder to expand it, or a file to preview its path and size."}
              </p>
            )}
            {selectedNode?.isDir && (
              <div className="space-y-2">
                <p className="text-sm">
                  {selectedNode.children.length} item{selectedNode.children.length === 1 ? "" : "s"} in this folder.
                </p>
                {selectedNode.children.length === 0 ? (
                  <p className="muted text-xs">Empty folder.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {selectedNode.children.map((child) => (
                      <li key={child.path}>
                        <button
                          type="button"
                          onClick={() => select(child)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        >
                          <span>{child.isDir ? "📁" : "📄"}</span>
                          <span className="min-w-0 flex-1 truncate font-mono">{child.name}</span>
                          {!child.isDir && <span className="muted">{formatFileSize(child.size)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {selectedNode && !selectedNode.isDir && (
              <div className="space-y-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="muted">Path</dt>
                  <dd className="truncate font-mono">{selectedNode.path}</dd>
                  <dt className="muted">Size</dt>
                  <dd>{formatFileSize(selectedNode.size)}</dd>
                  <dt className="muted">Modified</dt>
                  <dd>{formatModified(selectedNode.modified) || "—"}</dd>
                </dl>
                <button
                  onClick={() => onOpenFile(selectedNode.path)}
                  className="btn-primary rounded-md px-3 py-1.5 text-xs font-medium"
                >
                  Open file
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
