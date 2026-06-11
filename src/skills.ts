export interface Skill {
  /** Slug, taken from the folder name (also the value passed to `load_skill`). */
  name: string;
  /** One-line description shown to the model in the skill index. */
  description: string;
  /** Full SKILL.md body (everything after the frontmatter). */
  body: string;
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

/**
 * Scan `skills/<name>/SKILL.md` and load each skill. The folder name is the
 * canonical skill id; `name`/`description` may be overridden in frontmatter.
 */
export async function loadSkills(skillsDir = `${process.cwd()}/skills`): Promise<Skill[]> {
  const glob = new Bun.Glob("*/SKILL.md");
  const skills: Skill[] = [];

  try {
    // Glob matches are relative to `cwd` and use forward slashes,
    // e.g. "calculator/SKILL.md" — the first segment is the skill folder.
    for await (const match of glob.scan({ cwd: skillsDir })) {
      const dir = match.split("/")[0]!;
      const { meta, body } = parseFrontmatter(await Bun.file(`${skillsDir}/${match}`).text());
      skills.push({
        name: meta.name || dir,
        description: meta.description || "(no description)",
        body,
      });
    }
  } catch {
    return []; // no skills directory (or unreadable) — that's fine
  }

  // Stable order so the skill index is deterministic.
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Render the available-skills index injected into the system prompt. */
export function renderSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "No skills are currently available.";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
