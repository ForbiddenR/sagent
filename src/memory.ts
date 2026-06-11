import type { BaseMessage } from "@langchain/core/messages";

/**
 * Simple in-memory conversation store, keyed by session id.
 *
 * History lives in a plain Map and is lost when the process restarts — that's
 * intentional for this demo. Each session is trimmed to the most recent
 * `maxMessages` entries so context can't grow without bound.
 */
class SessionStore {
  private sessions = new Map<string, BaseMessage[]>();

  constructor(private readonly maxMessages = 20) {}

  /** Return the (live) message array for a session, creating it if needed. */
  getHistory(sessionId: string): BaseMessage[] {
    let history = this.sessions.get(sessionId);
    if (!history) {
      history = [];
      this.sessions.set(sessionId, history);
    }
    return history;
  }

  /** Append messages to a session, then trim to the last `maxMessages`. */
  append(sessionId: string, ...messages: BaseMessage[]): void {
    const history = this.getHistory(sessionId);
    history.push(...messages);
    if (history.length > this.maxMessages) {
      history.splice(0, history.length - this.maxMessages);
    }
  }

  /** Forget a single session. */
  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

/** Process-wide singleton — shared across all requests. */
export const memory = new SessionStore();
