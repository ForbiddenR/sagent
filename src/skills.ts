export interface Skill {
  /** Slug, taken from the folder name (also the value passed to `load_skill`). */
  name: string;
  /** One-line description shown to the model in the skill index. */
  description: string;
  /** Full SKILL.md body (everything after the frontmatter). */
  body: string;
  /** Marketplace address this skill was installed from, if any. */
  origin?: string;
}

export interface SkillInput {
  name: string;
  description: string;
  body: string;
  origin?: string;
}

/** Parse a tiny `--- key: value --- body` frontmatter block. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
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

export function sanitizeSkillName(name: string) {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("Skill name is required");
  return cleaned;
}

function renderSkillFile(skill: SkillInput) {
  const lines = [
    "---",
    `name: ${sanitizeSkillName(skill.name)}`,
    `description: ${skill.description.trim() || "(no description)"}`,
  ];
  if (skill.origin?.trim()) lines.push(`origin: ${skill.origin.trim()}`);
  lines.push("---", "", skill.body.trim() || `# ${sanitizeSkillName(skill.name)}\n\nAdd instructions for this skill here.`, "");
  return lines.join("\n");
}

export function injectOrigin(raw: string, origin: string, fallbackName?: string): string {
  const { meta, body } = parseFrontmatter(raw);
  return renderSkillFile({
    name: meta.name || fallbackName || "skill",
    description: meta.description || "(no description)",
    body,
    origin,
  });
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
        origin: meta.origin || undefined,
      });
    }
  } catch {
    return []; // no skills directory (or unreadable) — that's fine
  }

  // Stable order so the skill index is deterministic.
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSkill(skill: SkillInput, skillsDir = `${process.cwd()}/skills`): Promise<Skill> {
  const name = sanitizeSkillName(skill.name);
  const dir = `${skillsDir}/${name}`;
  let origin = skill.origin?.trim() || undefined;
  if (!origin) {
    const existing = Bun.file(`${dir}/SKILL.md`);
    if (await existing.exists()) {
      origin = parseFrontmatter(await existing.text()).meta.origin || undefined;
    }
  }
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(`${dir}/SKILL.md`, renderSkillFile({ ...skill, name, origin }));
  return {
    name,
    description: skill.description.trim() || "(no description)",
    body: skill.body.trim() || `# ${name}\n\nAdd instructions for this skill here.`,
    origin,
  };
}

export async function skillExists(name: string, skillsDir = `${process.cwd()}/skills`): Promise<boolean> {
  const safeName = sanitizeSkillName(name);
  return Bun.file(`${skillsDir}/${safeName}/SKILL.md`).exists();
}

/**
 * Copy a skill folder (SKILL.md plus optional scripts/references/assets) into
 * `skills/<name>/`. `files` paths are relative to the skill folder.
 */
export async function installSkillFiles(
  skill: { name: string; origin?: string },
  files: { path: string; bytes: Uint8Array }[],
  skillsDir = `${process.cwd()}/skills`,
): Promise<Skill> {
  const name = sanitizeSkillName(skill.name);
  const dest = `${skillsDir}/${name}`;
  const skillMd = files.find((f) => f.path.replace(/\\/g, "/") === "SKILL.md" || f.path.replace(/\\/g, "/").endsWith("/SKILL.md"));
  if (!skillMd) throw new Error("SKILL.md is required");

  await Bun.$`rm -rf ${dest}`.quiet();
  await Bun.$`mkdir -p ${dest}`.quiet();

  for (const file of files) {
    const rel = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.includes("\0") || rel.split("/").some((p) => p === ".." || p === "")) {
      throw new Error(`Invalid skill file path "${file.path}"`);
    }
    const target = `${dest}/${rel}`;
    await Bun.$`mkdir -p ${target.slice(0, target.lastIndexOf("/"))}`.quiet();
    const stampOrigin = Boolean(skill.origin?.trim()) && (rel === "SKILL.md" || rel.endsWith("/SKILL.md"));
    const bytes = stampOrigin
      ? new TextEncoder().encode(injectOrigin(new TextDecoder().decode(file.bytes), skill.origin!.trim(), name))
      : file.bytes;
    await Bun.write(target, bytes);
  }

  const { meta, body } = parseFrontmatter(await Bun.file(`${dest}/SKILL.md`).text());
  return {
    name,
    description: meta.description || "(no description)",
    body,
    origin: meta.origin || skill.origin,
  };
}

export async function deleteSkill(name: string, skillsDir = `${process.cwd()}/skills`): Promise<boolean> {
  const safeName = sanitizeSkillName(name);
  const dir = `${skillsDir}/${safeName}`;
  const file = Bun.file(`${dir}/SKILL.md`);
  if (!(await file.exists())) return false;
  await Bun.$`rm -rf ${dir}`.quiet();
  return true;
}

/** Render the available-skills index injected into the system prompt. */
export function renderSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return "No skills are currently available.";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
