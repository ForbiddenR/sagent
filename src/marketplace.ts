import {
  installSkillFiles,
  parseFrontmatter,
  sanitizeSkillName,
  skillExists,
  type Skill,
} from "./skills.ts";

const MARKETPLACE_STORE_FILE = process.env.MARKETPLACE_STORE_FILE || `${process.cwd()}/.marketplaces.json`;
const MARKETPLACE_CACHE = process.env.MARKETPLACE_CACHE || `${process.cwd()}/.marketplaces`;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SKILL_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_FILES = 80;

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    "user-agent": "sagent-marketplace",
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export interface MarketplaceSource {
  id: string;
  address: string;
  kind: "github" | "git" | "json" | "local";
  label: string;
  addedAt: string;
  updatedAt?: string;
  lastError?: string;
}

export interface CatalogSkill {
  name: string;
  description: string;
  path: string;
  installed: boolean;
}

export interface MarketplaceCatalog {
  source: MarketplaceSource;
  skills: CatalogSkill[];
}

interface PersistedStore {
  sources: MarketplaceSource[];
}

function persistPath() {
  return MARKETPLACE_STORE_FILE;
}

function cacheRoot() {
  return MARKETPLACE_CACHE.replace(/\/+$/, "");
}

function newId() {
  return crypto.randomUUID();
}

export function sanitizeSlug(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("Invalid marketplace address");
  return cleaned;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
}

export function classifyAddress(raw: string): { kind: MarketplaceSource["kind"]; address: string; label: string } {
  const address = raw.trim();
  if (!address) throw new Error("Marketplace address is required");

  if (isLocalPath(address)) {
    return { kind: "local", address, label: address.split("/").filter(Boolean).at(-1) || address };
  }

  if (address.endsWith(".json") && isHttpUrl(address)) {
    return { kind: "json", address, label: new URL(address).hostname };
  }

  if (isHttpUrl(address)) {
    const url = new URL(address);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "github.com") {
      const parts = url.pathname.replace(/^\//, "").split("/").filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0]!;
        const repo = parts[1]!.replace(/\.git$/i, "");
        const ref = url.hash.replace(/^#/, "") || url.pathname.split("/tree/")[1]?.split("/")[0] || "";
        const shorthand = ref && !ref.includes("/") ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
        return { kind: "github", address: shorthand, label: `${owner}/${repo}` };
      }
    }
    if (url.pathname.endsWith(".git") || host === "gitlab.com" || host === "bitbucket.org" || host.endsWith(".gitea.io")) {
      return { kind: "git", address, label: url.pathname.split("/").filter(Boolean).at(-1)?.replace(/\.git$/i, "") || host };
    }
    return { kind: "json", address, label: host };
  }

  if (address.startsWith("git@") || address.endsWith(".git")) {
    const label = address.replace(/\.git(#.*)?$/i, "").split("/").filter(Boolean).at(-1) || address;
    return { kind: "git", address, label };
  }

  const gh = address.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@(.+))?$/);
  if (gh) {
    const owner = gh[1]!;
    const repo = gh[2]!.replace(/\.git$/i, "");
    const ref = gh[3]?.trim();
    const shorthand = ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
    return { kind: "github", address: shorthand, label: `${owner}/${repo}` };
  }

  throw new Error("Address must be owner/repo, a git URL, a marketplace.json URL, or a local path");
}

async function fetchText(url: string, headers?: HeadersInit): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: headers ?? { "user-agent": "sagent-marketplace" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.text();
}

async function fetchJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const text = await fetchText(url, headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Not JSON: ${url}`);
  }
}

function marketplaceRootFromJsonUrl(url: string): string {
  const claude = url.match(/^(.*)\/\.claude-plugin\/[^/]+$/);
  if (claude) return `${claude[1]}/`;
  return url.replace(/\/[^/]+$/, "/");
}

function joinUrl(base: string, path: string) {
  const trimmed = base.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  return `${trimmed}/${rel}`;
}

interface ManifestPlugin {
  name?: string;
  description?: string;
  source?: unknown;
  skills?: unknown;
}

interface MarketplaceManifest {
  name?: string;
  description?: string;
  metadata?: { description?: string };
  plugins?: ManifestPlugin[];
}

function asRelativePath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value.startsWith("./") && !value.startsWith("skills/") && !value.includes("/")) return value;
  if (value.includes("://") || value.includes("\0")) return undefined;
  return value;
}

function pluginSkillDirs(plugin: ManifestPlugin): string[] {
  const dirs: string[] = [];
  if (Array.isArray(plugin.skills)) {
    for (const entry of plugin.skills) {
      const path = asRelativePath(entry);
      if (path) dirs.push(path);
    }
  }
  const source = asRelativePath(plugin.source);
  if (dirs.length === 0 && source) {
    dirs.push(source === "./" ? "skills" : `${source.replace(/\/+$/, "")}/skills`);
  }
  return dirs;
}

function skillNameFromPath(path: string, metaName?: string) {
  if (metaName?.trim()) {
    try {
      return sanitizeSkillName(metaName);
    } catch {
      // fall through
    }
  }
  const parts = path.replace(/\/+$/, "").split("/");
  const last = parts.at(-1) === "SKILL.md" ? parts.at(-2) : parts.at(-1);
  return sanitizeSkillName(last || "skill");
}

async function readLocalSkill(root: string, dir: string): Promise<{ name: string; description: string; path: string } | null> {
  const rel = dir.replace(/\/+$/, "").replace(/^\.\//, "");
  const skillFile = rel.endsWith("SKILL.md") ? `${root}/${rel}` : `${root}/${rel}/SKILL.md`;
  const file = Bun.file(skillFile);
  if (!(await file.exists())) return null;
  const { meta } = parseFrontmatter(await file.text());
  const folder = rel.endsWith("SKILL.md") ? rel.slice(0, -"/SKILL.md".length) : rel;
  return {
    name: skillNameFromPath(folder, meta.name),
    description: meta.description || "(no description)",
    path: folder,
  };
}

async function scanLocalSkills(root: string, extraDirs: string[] = []): Promise<{ name: string; description: string; path: string }[]> {
  const found = new Map<string, { name: string; description: string; path: string }>();

  async function add(dir: string) {
    const skill = await readLocalSkill(root, dir);
    if (skill && !found.has(skill.name)) found.set(skill.name, skill);
  }

  for (const dir of extraDirs) await add(dir);

  const glob = new Bun.Glob("**/SKILL.md");
  try {
    for await (const match of glob.scan({ cwd: root })) {
      const folder = match.split("/").slice(0, -1).join("/");
      if (!folder) continue;
      await add(folder);
    }
  } catch {
    // unreadable root
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function cloneGit(url: string, dest: string, ref?: string) {
  await Bun.$`rm -rf ${dest}`.quiet();
  await Bun.$`mkdir -p ${dest}`.quiet();
  const clone = ref
    ? Bun.$`git clone --depth 1 --branch ${ref} ${url} ${dest}`
    : Bun.$`git clone --depth 1 ${url} ${dest}`;
  const result = await clone.quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `git clone failed for ${url}`);
  }
}

function githubRawBase(owner: string, repo: string, ref: string) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}`;
}

function parseGithub(address: string): { owner: string; repo: string; ref?: string } {
  const match = address.match(/^([^/@]+)\/([^/@]+)(?:@(.+))?$/);
  if (!match) throw new Error(`Invalid GitHub address "${address}"`);
  return { owner: match[1]!, repo: match[2]!, ref: match[3] };
}

async function githubDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const data = await fetchJson<{ default_branch?: string }>(
      `https://api.github.com/repos/${owner}/${repo}`,
      githubHeaders(),
    );
    return data.default_branch || "main";
  } catch {
    return "main";
  }
}

async function githubTree(owner: string, repo: string, ref: string): Promise<string[]> {
  const data = await fetchJson<{ tree?: { path: string; type: string }[]; truncated?: boolean; message?: string }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    githubHeaders(),
  );
  if (data.message) throw new Error(data.message);
  if (data.truncated) throw new Error("GitHub tree is truncated");
  return (data.tree ?? []).filter((n) => n.type === "blob").map((n) => n.path);
}

async function loadManifestFromText(text: string): Promise<MarketplaceManifest | null> {
  try {
    return JSON.parse(text) as MarketplaceManifest;
  } catch {
    return null;
  }
}

async function catalogFromGitRoot(root: string): Promise<{ name: string; description: string; path: string }[]> {
  const extra: string[] = [];
  const manifestFile = Bun.file(`${root}/.claude-plugin/marketplace.json`);
  if (await manifestFile.exists()) {
    const manifest = await loadManifestFromText(await manifestFile.text());
    for (const plugin of manifest?.plugins ?? []) extra.push(...pluginSkillDirs(plugin));
  }
  return scanLocalSkills(root, extra);
}

async function catalogGithub(address: string): Promise<{ name: string; description: string; path: string }[]> {
  const { owner, repo, ref: pinned } = parseGithub(address);
  const ref = pinned || (await githubDefaultBranch(owner, repo));
  const base = githubRawBase(owner, repo, ref);
  const extra: string[] = [];

  try {
    const manifest = await loadManifestFromText(await fetchText(`${base}/.claude-plugin/marketplace.json`));
    for (const plugin of manifest?.plugins ?? []) extra.push(...pluginSkillDirs(plugin));
  } catch {
    // no marketplace.json — scan the tree
  }

  const found = new Map<string, { name: string; description: string; path: string }>();

  async function addDir(dir: string) {
    const rel = dir.replace(/^\.\//, "").replace(/\/+$/, "");
    const skillPath = rel.endsWith("SKILL.md") ? rel : `${rel}/SKILL.md`;
    try {
      const raw = await fetchText(`${base}/${skillPath}`);
      const { meta } = parseFrontmatter(raw);
      const folder = skillPath.slice(0, -"/SKILL.md".length);
      const skill = {
        name: skillNameFromPath(folder, meta.name),
        description: meta.description || "(no description)",
        path: folder,
      };
      if (!found.has(skill.name)) found.set(skill.name, skill);
    } catch {
      // missing
    }
  }

  if (extra.length > 0) {
    for (const dir of extra) await addDir(dir);
  }

  if (found.size === 0) {
    try {
      const paths = await githubTree(owner, repo, ref);
      const folders = new Set<string>();
      for (const path of paths) {
        if (!path.endsWith("/SKILL.md") && path !== "SKILL.md") continue;
        const folder = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length);
        if (folder) folders.add(folder);
      }
      for (const folder of folders) await addDir(folder);
    } catch {
      const dest = `${cacheRoot()}/github-${sanitizeSlug(owner)}-${sanitizeSlug(repo)}`;
      await cloneGit(`https://github.com/${owner}/${repo}.git`, dest, pinned);
      return catalogFromGitRoot(dest);
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function catalogJson(url: string): Promise<{ name: string; description: string; path: string }[]> {
  const manifest = await fetchJson<MarketplaceManifest>(url);
  const plugins = manifest.plugins ?? [];
  if (plugins.length === 0) throw new Error("marketplace.json has no plugins");

  const found = new Map<string, { name: string; description: string; path: string }>();
  const catalogBase = marketplaceRootFromJsonUrl(url);

  for (const plugin of plugins) {
    const source = plugin.source;
    if (source && typeof source === "object") {
      const obj = source as { source?: string; repo?: string; url?: string };
      if (obj.source === "github" && obj.repo) {
        for (const skill of await catalogGithub(obj.repo)) {
          if (!found.has(skill.name)) found.set(skill.name, skill);
        }
        continue;
      }
      if ((obj.source === "url" || obj.source === "git") && obj.url) {
        const dest = `${cacheRoot()}/json-${sanitizeSlug(plugin.name || obj.url)}`;
        await cloneGit(obj.url, dest);
        for (const skill of await catalogFromGitRoot(dest)) {
          if (!found.has(skill.name)) found.set(skill.name, skill);
        }
        continue;
      }
    }

    const dirs = pluginSkillDirs(plugin);
    for (const dir of dirs) {
      const rel = dir.replace(/^\.\//, "").replace(/\/+$/, "");
      const skillPath = rel.endsWith("SKILL.md") ? rel : `${rel}/SKILL.md`;
      try {
        const raw = await fetchText(joinUrl(catalogBase, skillPath));
        const { meta } = parseFrontmatter(raw);
        const folder = skillPath.slice(0, -"/SKILL.md".length);
        const skill = {
          name: skillNameFromPath(folder, meta.name),
          description: meta.description || plugin.description || "(no description)",
          path: folder,
        };
        if (!found.has(skill.name)) found.set(skill.name, skill);
      } catch {
        // skip missing remote skill
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function cloneSource(source: MarketplaceSource): Promise<string> {
  const dest = `${cacheRoot()}/${source.id}`;
  if (source.kind === "local") return source.address;
  if (source.kind === "github") {
    const { owner, repo, ref } = parseGithub(source.address);
    await cloneGit(`https://github.com/${owner}/${repo}.git`, dest, ref);
    return dest;
  }
  if (source.kind === "git") {
    const [url, hashRef] = source.address.split("#");
    await cloneGit(url!, dest, hashRef);
    return dest;
  }
  throw new Error("JSON catalogs are fetched without cloning");
}

async function listSkillFiles(root: string, skillPath: string): Promise<{ path: string; bytes: Uint8Array }[]> {
  const folder = `${root}/${skillPath.replace(/^\.\//, "").replace(/\/+$/, "")}`;
  const files: { path: string; bytes: Uint8Array }[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const match of glob.scan({ cwd: folder })) {
    const file = Bun.file(`${folder}/${match}`);
    const stat = await file.stat().catch(() => null);
    if (!stat || stat.isDirectory()) continue;
    if (match.split("/").some((p) => p === ".." || p.startsWith("."))) continue;
    if (file.size > MAX_SKILL_BYTES) throw new Error(`File ${match} is larger than 2MB`);
    files.push({ path: match, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (files.length > MAX_SKILL_FILES) throw new Error("Skill has too many files");
  }
  if (!files.some((f) => f.path === "SKILL.md")) throw new Error(`No SKILL.md in ${skillPath}`);
  return files;
}

async function fetchGithubSkillFiles(address: string, skillPath: string): Promise<{ path: string; bytes: Uint8Array }[]> {
  const { owner, repo, ref: pinned } = parseGithub(address);
  const ref = pinned || (await githubDefaultBranch(owner, repo));
  const paths = await githubTree(owner, repo, ref);
  const prefix = `${skillPath.replace(/^\.\//, "").replace(/\/+$/, "")}/`;
  const matches = paths.filter((p) => p === `${prefix}SKILL.md` || p.startsWith(prefix));
  if (matches.length === 0) throw new Error(`Skill "${skillPath}" not found in ${address}`);
  const files: { path: string; bytes: Uint8Array }[] = [];
  const base = githubRawBase(owner, repo, ref);
  for (const path of matches) {
    const rel = path.slice(prefix.length);
    if (!rel || rel.split("/").some((p) => p === ".." || p.startsWith("."))) continue;
    const res = await fetch(`${base}/${path}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: githubHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_SKILL_BYTES) throw new Error(`File ${rel} is larger than 2MB`);
    files.push({ path: rel, bytes });
    if (files.length > MAX_SKILL_FILES) throw new Error("Skill has too many files");
  }
  if (!files.some((f) => f.path === "SKILL.md")) throw new Error(`No SKILL.md in ${skillPath}`);
  return files;
}

class MarketplaceStore {
  private sources: MarketplaceSource[] = [];
  private loaded = false;

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await Bun.file(persistPath()).text();
      const data = JSON.parse(raw) as PersistedStore;
      this.sources = Array.isArray(data.sources) ? data.sources : [];
    } catch {
      this.sources = [];
    }
  }

  private persist() {
    return Bun.write(persistPath(), JSON.stringify({ sources: this.sources }, null, 2));
  }

  async list(): Promise<MarketplaceSource[]> {
    await this.load();
    return this.sources;
  }

  async add(address: string): Promise<MarketplaceSource> {
    await this.load();
    const classified = classifyAddress(address);
    const existing = this.sources.find((s) => s.address === classified.address);
    if (existing) return existing;
    const source: MarketplaceSource = {
      id: newId(),
      address: classified.address,
      kind: classified.kind,
      label: classified.label,
      addedAt: new Date().toISOString(),
    };
    this.sources.push(source);
    await this.persist();
    return source;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const next = this.sources.filter((s) => s.id !== id);
    if (next.length === this.sources.length) return false;
    this.sources = next;
    await this.persist();
    await Bun.$`rm -rf ${cacheRoot()}/${id}`.quiet().nothrow();
    return true;
  }

  async get(id: string): Promise<MarketplaceSource | undefined> {
    await this.load();
    return this.sources.find((s) => s.id === id);
  }

  async touch(id: string, patch: Partial<MarketplaceSource>) {
    await this.load();
    this.sources = this.sources.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s));
    await this.persist();
  }
}

const store = new MarketplaceStore();

export async function listMarketplaces(): Promise<MarketplaceSource[]> {
  return store.list();
}

export async function addMarketplace(address: string): Promise<MarketplaceSource> {
  return store.add(address);
}

export async function removeMarketplace(id: string): Promise<boolean> {
  return store.remove(id);
}

async function withInstalled(skills: { name: string; description: string; path: string }[]): Promise<CatalogSkill[]> {
  const out: CatalogSkill[] = [];
  for (const skill of skills) {
    out.push({ ...skill, installed: await skillExists(skill.name) });
  }
  return out;
}

export async function browseMarketplace(id: string): Promise<MarketplaceCatalog> {
  const source = await store.get(id);
  if (!source) throw new Error("Marketplace not found");

  try {
    let skills: { name: string; description: string; path: string }[] = [];
    if (source.kind === "github") skills = await catalogGithub(source.address);
    else if (source.kind === "json") skills = await catalogJson(source.address);
    else {
      const root = source.kind === "local" ? source.address : await cloneSource(source);
      skills = await catalogFromGitRoot(root);
    }
    await store.touch(source.id, { lastError: undefined });
    return { source: (await store.get(id))!, skills: await withInstalled(skills) };
  } catch (err) {
    const message = (err as Error).message;
    await store.touch(source.id, { lastError: message });
    throw err;
  }
}

export async function installMarketplaceSkill(id: string, name: string): Promise<Skill> {
  const catalog = await browseMarketplace(id);
  const entry = catalog.skills.find((s) => s.name === name);
  if (!entry) throw new Error(`Skill "${name}" is not in this marketplace`);

  const origin = catalog.source.address;
  let files: { path: string; bytes: Uint8Array }[];
  if (catalog.source.kind === "github") {
    try {
      files = await fetchGithubSkillFiles(catalog.source.address, entry.path);
    } catch {
      const root = await cloneSource(catalog.source);
      files = await listSkillFiles(root, entry.path);
    }
  } else if (catalog.source.kind === "json") {
    const url = catalog.source.address;
    const base = marketplaceRootFromJsonUrl(url);
    const prefix = `${entry.path.replace(/^\.\//, "").replace(/\/+$/, "")}/`;
    const skillMd = await fetch(joinUrl(base, `${prefix}SKILL.md`), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "sagent-marketplace" },
    });
    if (!skillMd.ok) throw new Error(`Failed to fetch SKILL.md for ${name}`);
    files = [{ path: "SKILL.md", bytes: new Uint8Array(await skillMd.arrayBuffer()) }];
  } else {
    const root = catalog.source.kind === "local" ? catalog.source.address : await cloneSource(catalog.source);
    files = await listSkillFiles(root, entry.path);
  }

  return installSkillFiles({ name: entry.name, origin }, files);
}
