import type { SessionMode } from "./memory.ts";

export interface SubagentDef {
  /** Slug used as `subagent_type` on the `task` tool. */
  name: string;
  /** One-line description of when the parent should pick this type. */
  description: string;
  /** System prompt that defines the subagent's role. */
  prompt: string;
  /**
   * Tool names this subagent may use. Omit (or empty) to inherit every parent
   * tool except `task` — subagents cannot spawn nested subagents by default.
   */
  tools?: string[];
}

export const WRITE_TOOLS = ["write_file", "run_bash"] as const;

/** Parent tools in plan mode — reads, search, and `task` (added separately). */
export const PLAN_PARENT_TOOLS = [
  "calculator",
  "current_time",
  "read_file",
  "search_workspace",
  "web_search_exa",
  "web_fetch_exa",
  "load_skill",
];

export function isReadOnlySubagent(def: SubagentDef): boolean {
  if (!def.tools || def.tools.length === 0) return false;
  return !def.tools.some((name) => (WRITE_TOOLS as readonly string[]).includes(name));
}

export function subagentsForMode(subagents: SubagentDef[], mode: SessionMode): SubagentDef[] {
  if (mode !== "plan") return subagents;
  return subagents.filter(isReadOnlySubagent);
}

/** Parse a tiny `--- key: value --- body` frontmatter block. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body: match[2]!.trim() };
}

function sanitizeName(name: string) {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("Subagent name is required");
  return cleaned;
}

function parseTools(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const tools = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

export const BUILTIN_SUBAGENTS: SubagentDef[] = [
  {
    name: "general",
    description:
      "General-purpose agent for multi-step tasks that may read or write files, run commands, or search the web. Use to run independent units of work in parallel.",
    prompt: [
      "You are a capable general-purpose subagent.",
      "Complete the assigned task thoroughly.",
      "Use tools when they help; do not ask the user questions.",
      "Return a concise final answer with the facts, files changed, and any remaining blockers the parent needs.",
    ].join("\n"),
  },
  {
    name: "explore",
    description:
      "Fast, read-only agent for searching the workspace or the public web. Cannot modify files or run shell commands.",
    prompt: [
      "You are a read-only exploration subagent.",
      "Find the requested information using read, search, and web tools only.",
      "Do not write files or run shell commands.",
      "Return a concise report with paths, URLs, and the evidence the parent needs. Cite sources.",
    ].join("\n"),
    tools: [
      "calculator",
      "current_time",
      "read_file",
      "search_workspace",
      "web_search_exa",
      "web_fetch_exa",
      "load_skill",
    ],
  },
];

/**
 * Scan `agents/<name>/AGENT.md` and load each subagent. Folder name is the
 * canonical id; frontmatter may override `name` / `description` / `tools`.
 * Built-in `general` and `explore` are always available; files with the same
 * name override the built-in definition.
 */
export async function loadSubagents(agentsDir = `${process.cwd()}/agents`): Promise<SubagentDef[]> {
  const byName = new Map(BUILTIN_SUBAGENTS.map((a) => [a.name, a]));
  const glob = new Bun.Glob("*/AGENT.md");

  try {
    for await (const match of glob.scan({ cwd: agentsDir })) {
      const dir = match.split("/")[0]!;
      const { meta, body } = parseFrontmatter(await Bun.file(`${agentsDir}/${match}`).text());
      const name = sanitizeName(meta.name || dir);
      byName.set(name, {
        name,
        description: meta.description || "(no description)",
        prompt: body || BUILTIN_SUBAGENTS.find((a) => a.name === name)?.prompt || "",
        tools: parseTools(meta.tools),
      });
    }
  } catch {
    // no agents directory — built-ins still apply
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One-line catalog injected into the parent system prompt and the `task` tool. */
export function renderSubagentCatalog(subagents: SubagentDef[]): string {
  if (subagents.length === 0) return "No subagents are currently available.";
  return subagents.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
