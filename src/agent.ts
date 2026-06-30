import { ChatAnthropic } from "@langchain/anthropic";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  type AIMessageChunk,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { memory } from "./memory.ts";
import { buildTools } from "./tools.ts";
import { renderSkillIndex, type Skill } from "./skills.ts";

const MODEL = process.env.MODEL || "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;
const TOP_P = Number(process.env.TOP_P ?? "1");
// Max ms to wait for the next chunk from the model before treating the request
// as stalled/timed out. A long generation that keeps streaming is fine; only a
// complete silence for this long trips the timeout.
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? "60000");

const TIMEOUT_HINT =
  "The request to the AI model timed out. Please check the API — verify your ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (if set), network connectivity, and that the model is available, then try again.";

/** Thrown when the model produces no chunk within MODEL_TIMEOUT_MS. */
class StallTimeoutError extends Error {
  constructor(ms: number) {
    super(`Model did not respond within ${Math.round(ms / 1000)}s`);
    this.name = "StallTimeoutError";
  }
}

/** True for errors that look like a timed-out / aborted request to the model. */
function isTimeoutLikeError(err: unknown): boolean {
  if (err instanceof StallTimeoutError) return true;
  const e = err as { name?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.name === "AbortError") return true;
  return /\b(timeout|timed out|etimedout|aborted)\b/i.test(e.message ?? "");
}

/** Resolve `p` but reject with StallTimeoutError if it takes longer than stallMs. */
function raceWithStall<T>(p: Promise<T>, stallMs: number, onStall: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onStall();
      reject(new StallTimeoutError(stallMs));
    }, stallMs);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Yield chunks from `source`, but reject with StallTimeoutError if acquiring the
 * stream OR waiting for the next chunk exceeds `stallMs`. Calls `onStall`
 * (e.g. to abort the underlying fetch) the instant a stall is detected.
 */
async function* withStallTimeout<T>(
  source: Promise<AsyncIterable<T>> | AsyncIterable<T>,
  stallMs: number,
  onStall: () => void,
): AsyncGenerator<T> {
  const resolved = await raceWithStall(Promise.resolve(source), stallMs, onStall);
  const it = resolved[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await raceWithStall(it.next(), stallMs, onStall);
      if (result.done) return;
      yield result.value;
    }
  } finally {
    await it.return?.();
  }
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  name: "run_bash";
  args?: Record<string, unknown>;
}

export type ApprovalRequestFn = (request: ApprovalRequest) => Promise<boolean>;

/** Events streamed out of the agent as it works. */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "skill"; name: string }
  | { type: "approval_request"; id: string; name: "run_bash"; args?: Record<string, unknown> }
  | { type: "approval_result"; id: string; approved: boolean }
  | { type: "done"; text: string }
  | { type: "timeout"; message: string }
  | { type: "error"; message: string };

type ToolCallLike = {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
};

class EventQueue<T> {
  private items: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      const next = await this.next();
      if (next.done) return;
      yield next.value;
    }
  }

  private next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Pull plain text out of a chunk's content (string delta or content blocks). */
function extractText(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block.type === "text"
            ? (block.text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

function getToolCalls(message?: BaseMessage): ToolCallLike[] {
  const calls = (message as { tool_calls?: ToolCallLike[] } | undefined)?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

export function createAgent(allSkills: Skill[], requestApproval?: ApprovalRequestFn) {
  const allSkillNames = allSkills.map((s) => s.name);

  const llm = (skills: Skill[], sessionId: string) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).");
    }
    return new ChatAnthropic({
      model: MODEL,
      maxTokens: 4096,
      apiKey: process.env.ANTHROPIC_API_KEY,
      topP: TOP_P,
      // Optional: point at an Anthropic-compatible third-party endpoint
      // (gateway/proxy). Left undefined → talks to the default Anthropic API.
      ...(process.env.ANTHROPIC_BASE_URL ? { anthropicApiUrl: process.env.ANTHROPIC_BASE_URL } : {}),
    }).bindTools(buildTools(skills, sessionId));
  };

  function systemPrompt(skills: Skill[]) {
    return [
      "You are a helpful assistant with access to tools and a set of enabled skills.",
      "Use the `calculator` tool for any non-trivial arithmetic.",
      "Use `current_time` when the user asks about the date or time.",
      "Use `read_file` and `write_file` to read/write files in your private session workspace.",
      "Use `run_bash` to execute shell commands in your session workspace.",
      "Use `search_workspace` to search all workspace files by semantic meaning (better than read_file when you don't know the exact filename).",
      "",
      "Enabled skills (call `load_skill` with the skill name to read its full",
      "instructions BEFORE doing a task it covers):",
      renderSkillIndex(skills),
      "",
      "If a skill is not listed above, it is disabled for this session and you must not use it.",
      "When reporting the result of a tool or skill call, put the label and the value on separate lines for readability.",
      "Be concise. Show your final answer clearly.",
    ].join("\n");
  }

  /** Run one user turn, streaming events. Persists user + final answer to memory. */
  async function* run(sessionId: string, userText: string): AsyncGenerator<AgentEvent> {
    const activeSkillNames = new Set(memory.getActiveSkills(sessionId, allSkillNames));
    const activeSkills = allSkills.filter((skill) => activeSkillNames.has(skill.name));
    const tools = buildTools(activeSkills, sessionId);
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const events = new EventQueue<AgentEvent>();

    memory.append(sessionId, new HumanMessage(userText));

    // Working transcript for this turn: system + persisted history.
    // Intermediate tool_use / tool_result messages stay local (not persisted),
    // keeping stored memory to clean user/assistant text pairs.
    const initialMessages: BaseMessage[] = [
      new SystemMessage(systemPrompt(activeSkills)),
      ...memory.getHistory(sessionId),
    ];

    const StateAnnotation = Annotation.Root({
      messages: Annotation<BaseMessage[], BaseMessage | BaseMessage[]>({
        reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
        default: () => [],
      }),
      finalText: Annotation<string>(),
      done: Annotation<boolean>(),
      rounds: Annotation<number>(),
    });

    const model = llm(activeSkills, sessionId);

    async function callModel(state: typeof StateAnnotation.State) {
      // Abort the underlying fetch if the model stalls, so we don't hang on an
      // unreachable / wedged API endpoint and leave the UI spinning forever.
      const controller = new AbortController();
      const stream = model.stream(state.messages, { signal: controller.signal });

      let gathered: AIMessageChunk | undefined;
      for await (const chunk of withStallTimeout(
        stream as Promise<AsyncIterable<AIMessageChunk>>,
        MODEL_TIMEOUT_MS,
        () => controller.abort(),
      )) {
        gathered = gathered === undefined ? chunk : gathered.concat(chunk);
        const text = extractText(chunk.content);
        if (text) events.push({ type: "token", text });
      }

      if (!gathered) {
        events.push({ type: "done", text: "" });
        return { done: true, finalText: "", rounds: state.rounds + 1 };
      }

      const toolCalls = gathered.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const finalText = extractText(gathered.content);
        memory.append(sessionId, new AIMessage(finalText));
        events.push({ type: "done", text: finalText });
        return { messages: gathered, done: true, finalText, rounds: state.rounds + 1 };
      }

      return { messages: gathered, done: false, finalText: "", rounds: state.rounds + 1 };
    }

    async function callTools(state: typeof StateAnnotation.State) {
      const toolMessages: ToolMessage[] = [];
      const toolCalls = getToolCalls(state.messages.at(-1));

      for (const call of toolCalls) {
        const args = call.args;
        if (call.name === "load_skill") {
          const skillName = typeof args?.name === "string" ? args.name : "unknown";
          events.push({ type: "skill", name: skillName });
        } else {
          events.push({ type: "tool", name: call.name, args });
        }

        const selected = toolsByName.get(call.name);
        let result: string;
        if (!selected) {
          result = `Error: unknown or disabled tool "${call.name}"`;
        } else if (call.name === "run_bash" && requestApproval) {
          const approvalId = crypto.randomUUID();
          events.push({ type: "approval_request", id: approvalId, name: "run_bash", args });
          const approved = await requestApproval({ id: approvalId, sessionId, name: "run_bash", args });
          events.push({ type: "approval_result", id: approvalId, approved });
          result = approved
            ? String(await selected.invoke(args))
            : "Denied: user declined to run this command.";
        } else {
          result = String(await selected.invoke(args));
        }
        toolMessages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
      }

      return { messages: toolMessages };
    }

    function routeAfterModel(state: typeof StateAnnotation.State) {
      if (state.done || state.rounds >= MAX_TOOL_ROUNDS) return END;
      return getToolCalls(state.messages.at(-1)).length > 0 ? "tools" : END;
    }

    const graph = new StateGraph(StateAnnotation)
      .addNode("model", callModel)
      .addNode("tools", callTools)
      .addEdge(START, "model")
      .addConditionalEdges("model", routeAfterModel)
      .addEdge("tools", "model")
      .compile();

    const graphTask = (async () => {
      try {
        const result = await graph.invoke({
          messages: initialMessages,
          finalText: "",
          done: false,
          rounds: 0,
        });
        if (!result.done) events.push({ type: "done", text: "" });
      } catch (err) {
        if (isTimeoutLikeError(err)) {
          events.push({ type: "timeout", message: TIMEOUT_HINT });
        } else {
          events.push({ type: "error", message: (err as Error).message });
        }
      } finally {
        events.close();
      }
    })();

    for await (const event of events.drain()) {
      yield event;
    }
    await graphTask;
  }

  return { run };
}

export type Agent = ReturnType<typeof createAgent>;
