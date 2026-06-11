import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

export interface ClientMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  skills?: string[];
  completed?: boolean;
  error?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeSkills: string[];
}

interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  history: BaseMessage[];
  clientMessages: ClientMessage[];
  activeSkills: Set<string>;
}

function defaultTitle() {
  return `Session ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function titleFromMessage(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return defaultTitle();
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
}

/**
 * Simple in-memory conversation/session store.
 *
 * Everything lives in a plain Map and is lost when the process restarts — that's
 * intentional for this demo. LangChain history is trimmed to the most recent
 * `maxMessages` entries so context can't grow without bound.
 */
class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  constructor(private readonly maxMessages = 20) {}

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
    };
    this.sessions.set(id, record);
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
      };
      this.sessions.set(sessionId, record);
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
    return this.sessions.delete(sessionId);
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
    record.clientMessages.push(message);
    if (message.role === "user" && record.clientMessages.filter((m) => m.role === "user").length === 1) {
      record.title = titleFromMessage(message.text);
    }
    record.updatedAt = new Date().toISOString();
  }

  /** Forget messages in a session while keeping its title and active skills. */
  reset(sessionId: string): void {
    const record = this.ensureSession(sessionId);
    record.history = [];
    record.clientMessages = [];
    record.updatedAt = new Date().toISOString();
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
    return this.toSummary(record);
  }

  enableSkillForAll(skillName: string): void {
    for (const record of this.sessions.values()) {
      record.activeSkills.add(skillName);
      record.updatedAt = new Date().toISOString();
    }
  }

  disableSkillForAll(skillName: string): void {
    for (const record of this.sessions.values()) {
      record.activeSkills.delete(skillName);
      record.updatedAt = new Date().toISOString();
    }
  }

  private toSummary(record: SessionRecord): SessionSummary {
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      messageCount: record.clientMessages.length,
      activeSkills: [...record.activeSkills].sort(),
    };
  }
}

/** Process-wide singleton — shared across all requests. */
export const memory = new SessionStore();

export function toLangChainMessage(message: ClientMessage): BaseMessage {
  return message.role === "user" ? new HumanMessage(message.text) : new AIMessage(message.text);
}
