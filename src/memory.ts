import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

const SESSION_STORE_FILE = process.env.SESSION_STORE_FILE || `${process.cwd()}/.sessions.json`;
const MAX_MODEL_MESSAGES = Number(process.env.MAX_MODEL_MESSAGES || "100");

export type SubagentStep =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "skill"; name: string };

export interface SubagentRun {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  tools: Record<string, unknown>[];
  skills: string[];
  steps?: SubagentStep[];
  text?: string;
  done?: boolean;
}

export interface ClientMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  toolDetails?: Record<string, unknown>[];
  skills?: string[];
  subagents?: SubagentRun[];
  completed?: boolean;
  error?: string;
  timeout?: boolean;
}

export type SessionMode = "build" | "plan";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeSkills: string[];
  mode: SessionMode;
}

function normalizeMode(mode: unknown): SessionMode {
  return mode === "plan" ? "plan" : "build";
}

interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  history: BaseMessage[];
  clientMessages: ClientMessage[];
  activeSkills: Set<string>;
  mode: SessionMode;
}

interface PersistedSessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  clientMessages: ClientMessage[];
  activeSkills: string[];
  mode?: SessionMode;
}

interface PersistedSessionStore {
  sessions: PersistedSessionRecord[];
}

function defaultTitle() {
  return `Session ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function titleFromMessage(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return defaultTitle();
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
}

function normalizeClientMessage(message: ClientMessage): ClientMessage {
  return {
    ...message,
    tools: message.tools ?? [],
    skills: message.skills ?? [],
    subagents: (message.subagents ?? []).map((run) => ({
      ...run,
      tools: run.tools ?? [],
      skills: run.skills ?? [],
      steps: run.steps ?? [],
      done: run.done ?? true,
    })),
    completed: message.completed ?? true,
  };
}

export function appendSubagentText(run: SubagentRun, text: string) {
  run.text = (run.text ?? "") + text;
  const steps = run.steps ?? (run.steps = []);
  const last = steps.at(-1);
  if (last?.type === "text") last.text += text;
  else steps.push({ type: "text", text });
}

/**
 * Simple persisted conversation/session store.
 *
 * Session metadata and UI messages are written to `.sessions.json` by default so
 * sessions survive server restarts. LangChain history is reconstructed from the
 * persisted user/assistant text messages when the app starts.
 */
class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private persistQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly maxMessages = 20,
    private readonly filePath = SESSION_STORE_FILE,
  ) {}

  static async create(maxMessages = MAX_MODEL_MESSAGES, filePath = SESSION_STORE_FILE): Promise<SessionStore> {
    const store = new SessionStore(maxMessages, filePath);
    await store.load();
    return store;
  }

  createSession(title = defaultTitle(), allSkillNames: string[] = []): SessionSummary {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: SessionRecord = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      history: [],
      clientMessages: [],
      activeSkills: new Set(allSkillNames),
      mode: "build",
    };
    this.sessions.set(id, record);
    this.persistSoon();
    return this.toSummary(record);
  }

  ensureSession(sessionId: string, allSkillNames: string[] = []): SessionRecord {
    let record = this.sessions.get(sessionId);
    if (!record) {
      const now = new Date().toISOString();
      record = {
        id: sessionId,
        title: defaultTitle(),
        createdAt: now,
        updatedAt: now,
        history: [],
        clientMessages: [],
        activeSkills: new Set(allSkillNames),
        mode: "build",
      };
      this.sessions.set(sessionId, record);
      this.persistSoon();
    }
    return record;
  }

  listSessions(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => this.toSummary(session));
  }

  getSession(sessionId: string): SessionSummary | undefined {
    const record = this.sessions.get(sessionId);
    return record ? this.toSummary(record) : undefined;
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) this.persistSoon();
    return deleted;
  }

  /** Return the (live) message array for a session, creating it if needed. */
  getHistory(sessionId: string, allSkillNames: string[] = []): BaseMessage[] {
    return this.ensureSession(sessionId, allSkillNames).history;
  }

  getClientMessages(sessionId: string): ClientMessage[] {
    return this.sessions.get(sessionId)?.clientMessages ?? [];
  }

  /** Append LangChain messages to a session, then trim to the last `maxMessages`. */
  append(sessionId: string, ...messages: BaseMessage[]): void {
    const record = this.ensureSession(sessionId);
    record.history.push(...messages);
    if (record.history.length > this.maxMessages) {
      record.history.splice(0, record.history.length - this.maxMessages);
    }
    record.updatedAt = new Date().toISOString();
  }

  appendClientMessage(sessionId: string, message: ClientMessage): void {
    const record = this.ensureSession(sessionId);
    const normalized = normalizeClientMessage(message);
    record.clientMessages.push(normalized);
    if (normalized.role === "user" && record.clientMessages.filter((m) => m.role === "user").length === 1) {
      record.title = titleFromMessage(normalized.text);
    }
    record.updatedAt = new Date().toISOString();
    this.persistSoon();
  }

  /** Forget messages in a session while keeping its title and active skills. */
  reset(sessionId: string): void {
    const record = this.ensureSession(sessionId);
    record.history = [];
    record.clientMessages = [];
    record.updatedAt = new Date().toISOString();
    this.persistSoon();
  }

  getActiveSkills(sessionId: string, allSkillNames: string[] = []): string[] {
    const record = this.ensureSession(sessionId, allSkillNames);
    return [...record.activeSkills].sort();
  }

  setActiveSkills(sessionId: string, skillNames: string[], allSkillNames: string[]): SessionSummary {
    const allowed = new Set(allSkillNames);
    const record = this.ensureSession(sessionId, allSkillNames);
    record.activeSkills = new Set(skillNames.filter((name) => allowed.has(name)));
    record.updatedAt = new Date().toISOString();
    this.persistSoon();
    return this.toSummary(record);
  }

  getMode(sessionId: string): SessionMode {
    return this.ensureSession(sessionId).mode;
  }

  setMode(sessionId: string, mode: SessionMode): SessionSummary {
    const record = this.ensureSession(sessionId);
    record.mode = normalizeMode(mode);
    record.updatedAt = new Date().toISOString();
    this.persistSoon();
    return this.toSummary(record);
  }

  enableSkillForAll(skillName: string): void {
    for (const record of this.sessions.values()) {
      record.activeSkills.add(skillName);
      record.updatedAt = new Date().toISOString();
    }
    this.persistSoon();
  }

  disableSkillForAll(skillName: string): void {
    for (const record of this.sessions.values()) {
      record.activeSkills.delete(skillName);
      record.updatedAt = new Date().toISOString();
    }
    this.persistSoon();
  }

  private async load() {
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) return;

    try {
      const data = (await file.json()) as Partial<PersistedSessionStore>;
      for (const session of data.sessions ?? []) {
        const clientMessages = (session.clientMessages ?? []).map(normalizeClientMessage);
        const history = clientMessages
          .filter((message) => message.text.trim().length > 0)
          .map(toLangChainMessage)
          .slice(-this.maxMessages);

        this.sessions.set(session.id, {
          id: session.id,
          title: session.title || defaultTitle(),
          createdAt: session.createdAt || new Date().toISOString(),
          updatedAt: session.updatedAt || new Date().toISOString(),
          history,
          clientMessages,
          activeSkills: new Set(session.activeSkills ?? []),
          mode: normalizeMode(session.mode),
        });
      }
    } catch (err) {
      console.warn(`⚠️  Could not load persisted sessions from ${this.filePath}: ${(err as Error).message}`);
    }
  }

  private persistSoon() {
    this.persistQueue = this.persistQueue.then(() => this.persist()).catch((err) => {
      console.warn(`⚠️  Could not persist sessions to ${this.filePath}: ${(err as Error).message}`);
    });
  }

  private async persist() {
    const data: PersistedSessionStore = {
      sessions: [...this.sessions.values()].map((record) => ({
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        clientMessages: record.clientMessages,
        activeSkills: [...record.activeSkills].sort(),
        mode: record.mode,
      })),
    };

    await Bun.write(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  private toSummary(record: SessionRecord): SessionSummary {
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: record.clientMessages.length,
      activeSkills: [...record.activeSkills].sort(),
      mode: record.mode,
    };
  }
}

/** Process-wide singleton — shared across all requests. */
export const memory = await SessionStore.create();

export function toLangChainMessage(message: ClientMessage): BaseMessage {
  return message.role === "user" ? new HumanMessage(message.text) : new AIMessage(message.text);
}
