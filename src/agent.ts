import { Anthropic } from "@anthropic-ai/sdk";
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
import type { StructuredToolInterface } from "@langchain/core/tools";
import { memory, type SessionMode, type ThinkingLevel } from "./memory.ts";
import { buildTools } from "./tools.ts";
import { renderSkillIndex, type Skill } from "./skills.ts";
import {
  PLAN_PARENT_TOOLS,
  isReadOnlySubagent,
  renderSubagentCatalog,
  subagentsForMode,
  type SubagentDef,
} from "./subagents.ts";

const MODEL = process.env.MODEL || "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;
const MAX_SUBAGENT_ROUNDS = 8;
// Max ms to wait for the next chunk from the model before treating the request
// as stalled/timed out. A long generation that keeps streaming is fine; only a
// complete silence for this long trips the timeout.
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? "60000");

const TIMEOUT_HINT =
  "The request to the AI model timed out. Please check the API — verify your ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL (if set), network connectivity, and that the model is available, then try again.";

/** Console API keys (`X-Api-Key`) or Claude Code / OAuth bearer tokens. */
export function anthropicAuth() {
  const apiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || undefined;
  return { apiKey, authToken };
}

export function hasAnthropicAuth() {
  const { apiKey, authToken } = anthropicAuth();
  return Boolean(apiKey || authToken);
}

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
  | { type: "subagent_start"; id: string; name: string; description?: string; prompt?: string }
  | { type: "subagent_token"; id: string; text: string }
  | { type: "subagent_tool"; id: string; name: string; args?: Record<string, unknown> }
  | { type: "subagent_skill"; id: string; name: string }
  | { type: "subagent_done"; id: string; name: string; text: string }
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

function asArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { prompt: raw };
    }
  }
  return {};
}

function getToolCalls(message?: BaseMessage): ToolCallLike[] {
  const calls = (message as { tool_calls?: ToolCallLike[] } | undefined)?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => ({
    id: call.id,
    name: call.name,
    args: asArgs(call.args),
  }));
}

interface LoopContext {
  sessionId: string;
  skills: Skill[];
  tools: StructuredToolInterface[];
  persistFinal: boolean;
  events: EventQueue<AgentEvent>;
  maxRounds: number;
  mode: SessionMode;
  thinking: ThinkingLevel;
  subagent?: { id: string; name: string };
}

export function createAgent(
  allSkills: Skill[],
  allSubagents: SubagentDef[] = [],
  requestApproval?: ApprovalRequestFn,
) {
  const allSkillNames = allSkills.map((s) => s.name);

  const llm = (tools: StructuredToolInterface[], thinking: ThinkingLevel) => {
    const { apiKey, authToken } = anthropicAuth();
    if (!apiKey && !authToken) {
      throw new Error(
        "Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set. Add one to .env (see .env.example).",
      );
    }
    const chat = new ChatAnthropic({
      model: MODEL,
      maxTokens: 16_384,
      // Adaptive thinking + effort. topP/temperature are rejected while thinking is on.
      thinking: { type: "adaptive" },
      outputConfig: { effort: thinking },
      ...(apiKey
        ? { apiKey }
        : {
            // ChatAnthropic requires an API key unless we supply the client.
            // ANTHROPIC_AUTH_TOKEN is a Bearer token (Claude Code / OAuth), not an API key.
            createClient: (options: ConstructorParameters<typeof Anthropic>[0]) =>
              new Anthropic({
                ...options,
                apiKey: options?.apiKey ?? null,
                authToken: options?.authToken ?? authToken,
              }),
          }),
      // Optional: point at an Anthropic-compatible third-party endpoint
      // (gateway/proxy). Left undefined → talks to the default Anthropic API.
      ...(process.env.ANTHROPIC_BASE_URL ? { anthropicApiUrl: process.env.ANTHROPIC_BASE_URL } : {}),
    });
    return tools.length > 0 ? chat.bindTools(tools) : chat;
  };

  function parentSystemPrompt(skills: Skill[], subagents: SubagentDef[], mode: SessionMode) {
    const common = [
      "Use the `calculator` tool for any non-trivial arithmetic.",
      "Use `current_time` when the user asks about the date or time.",
      "Use `read_file` to read files in your private session workspace.",
      "Use `search_workspace` to search all workspace files by semantic meaning (better than read_file when you don't know the exact filename).",
      "Use `web_search_exa` to search the public web for current information. Follow up with `web_fetch_exa` to read full pages when search highlights are not enough.",
      "Use the `task` tool to delegate independent subtasks to specialized subagents. Each subagent starts with a fresh context — put every file path, constraint, and expected output in `prompt`. Launch multiple `task` calls in one turn to run them in parallel. Do not spawn a subagent for work a single tool call can finish.",
    ];

    const modeLines =
      mode === "plan"
        ? [
            "You are in PLAN MODE. Analyze and propose a plan. Do not implement it.",
            "You cannot write files or run shell commands. `write_file` and `run_bash` are disabled.",
            "If you need extra research, spawn the `explore` subagent (read-only). Do not spawn write-capable subagents.",
            "Return a numbered plan with: goal, steps, files or commands involved, risks, and what to do after the user switches to Build.",
            "Wait for the user to accept the plan (they will switch the session to Build). Do not claim you have already made changes.",
          ]
        : [
            "You are a helpful assistant with access to tools and a set of enabled skills.",
            "Use `write_file` to write files in your private session workspace.",
            "Use `run_bash` to execute shell commands in your session workspace.",
          ];

    return [
      ...modeLines,
      ...common,
      "",
      "Available subagents:",
      renderSubagentCatalog(subagents),
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

  function subagentSystemPrompt(def: SubagentDef, skills: Skill[]) {
    return [
      def.prompt,
      "",
      "You are a subagent. Complete the assigned task and return a concise final answer.",
      "Do not ask the user questions. You cannot spawn further subagents.",
      "",
      "Enabled skills (call `load_skill` with the skill name to read its full",
      "instructions BEFORE doing a task it covers):",
      renderSkillIndex(skills),
    ].join("\n");
  }

  function emitTool(ctx: LoopContext, name: string, args?: Record<string, unknown>) {
    if (ctx.subagent) {
      if (name === "load_skill") {
        const skillName = typeof args?.name === "string" ? args.name : "unknown";
        ctx.events.push({ type: "subagent_skill", id: ctx.subagent.id, name: skillName });
      } else {
        ctx.events.push({ type: "subagent_tool", id: ctx.subagent.id, name, args });
      }
      return;
    }
    if (name === "load_skill") {
      const skillName = typeof args?.name === "string" ? args.name : "unknown";
      ctx.events.push({ type: "skill", name: skillName });
    } else if (name !== "task") {
      ctx.events.push({ type: "tool", name, args });
    }
  }

  async function invokeTool(
    ctx: LoopContext,
    call: ToolCallLike,
  ): Promise<string> {
    const args = call.args ?? {};
    if (call.name === "task") {
      return runTask(ctx, args);
    }

    emitTool(ctx, call.name, args);

    const selected = ctx.tools.find((t) => t.name === call.name);
    if (!selected) return `Error: unknown or disabled tool "${call.name}"`;

    if (call.name === "run_bash" && requestApproval) {
      const approvalId = crypto.randomUUID();
      ctx.events.push({ type: "approval_request", id: approvalId, name: "run_bash", args });
      const approved = await requestApproval({
        id: approvalId,
        sessionId: ctx.sessionId,
        name: "run_bash",
        args,
      });
      ctx.events.push({ type: "approval_result", id: approvalId, approved });
      return approved
        ? String(await selected.invoke(args))
        : "Denied: user declined to run this command.";
    }

    return String(await selected.invoke(args));
  }

  async function runTask(parent: LoopContext, args: Record<string, unknown>): Promise<string> {
    if (parent.subagent) {
      return "Error: nested subagents are not allowed. Complete the task yourself.";
    }

    const parsed = asArgs(args);
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    const type = typeof parsed.subagent_type === "string" ? parsed.subagent_type.trim() : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim() : type;
    if (!prompt) return "Error: prompt is required.";
    if (!type) return "Error: subagent_type is required.";

    const allowed = subagentsForMode(allSubagents, parent.mode);
    const def = allowed.find((s) => s.name === type);
    if (!def) {
      const available = allowed.map((s) => s.name).join(", ") || "(none)";
      if (parent.mode === "plan") {
        return `Error: subagent_type "${type}" is not allowed in plan mode (write-capable workers are blocked). Available: ${available}.`;
      }
      return `Error: unknown subagent_type "${type}". Available: ${available}.`;
    }
    if (parent.mode === "plan" && !isReadOnlySubagent(def)) {
      return `Error: subagent "${type}" can write files. In plan mode only read-only subagents are allowed.`;
    }

    const id = crypto.randomUUID();
    parent.events.push({ type: "subagent_start", id, name: def.name, description, prompt });

    const childTools = buildTools(parent.skills, parent.sessionId, {
      allowedTools: def.tools,
    });
    const child: LoopContext = {
      sessionId: parent.sessionId,
      skills: parent.skills,
      tools: childTools,
      persistFinal: false,
      events: parent.events,
      maxRounds: MAX_SUBAGENT_ROUNDS,
      mode: parent.mode,
      thinking: parent.thinking,
      subagent: { id, name: def.name },
    };

    try {
      const result = await runLoop(child, [
        new SystemMessage(subagentSystemPrompt(def, parent.skills)),
        new HumanMessage(prompt),
      ]);
      const text = result.finalText || "(subagent produced no output)";
      parent.events.push({ type: "subagent_done", id, name: def.name, text });
      return text;
    } catch (err) {
      const message = isTimeoutLikeError(err)
        ? TIMEOUT_HINT
        : (err as Error).message;
      const text = `Error: ${message}`;
      parent.events.push({ type: "subagent_done", id, name: def.name, text });
      return text;
    }
  }

  async function runLoop(
    ctx: LoopContext,
    initialMessages: BaseMessage[],
  ): Promise<{ finalText: string; done: boolean }> {
    const StateAnnotation = Annotation.Root({
      messages: Annotation<BaseMessage[], BaseMessage | BaseMessage[]>({
        reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
        default: () => [],
      }),
      finalText: Annotation<string>(),
      done: Annotation<boolean>(),
      rounds: Annotation<number>(),
    });

    const model = llm(ctx.tools, ctx.thinking);

    async function callModel(state: typeof StateAnnotation.State) {
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
        if (text) {
          if (ctx.subagent) ctx.events.push({ type: "subagent_token", id: ctx.subagent.id, text });
          else ctx.events.push({ type: "token", text });
        }
      }

      if (!gathered) {
        if (!ctx.subagent) ctx.events.push({ type: "done", text: "" });
        return { done: true, finalText: "", rounds: state.rounds + 1 };
      }

      const toolCalls = gathered.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const finalText = extractText(gathered.content);
        if (ctx.persistFinal) memory.append(ctx.sessionId, new AIMessage(finalText));
        if (!ctx.subagent) ctx.events.push({ type: "done", text: finalText });
        return { messages: gathered, done: true, finalText, rounds: state.rounds + 1 };
      }

      return { messages: gathered, done: false, finalText: "", rounds: state.rounds + 1 };
    }

    async function callTools(state: typeof StateAnnotation.State) {
      const toolCalls = getToolCalls(state.messages.at(-1));
      const results: string[] = new Array(toolCalls.length);
      const taskIndexes: number[] = [];

      for (let i = 0; i < toolCalls.length; i++) {
        if (toolCalls[i]!.name === "task") taskIndexes.push(i);
        else results[i] = await invokeTool(ctx, toolCalls[i]!);
      }

      if (taskIndexes.length > 0) {
        await Promise.all(
          taskIndexes.map(async (i) => {
            results[i] = await invokeTool(ctx, toolCalls[i]!);
          }),
        );
      }

      return {
        messages: toolCalls.map(
          (call, i) =>
            new ToolMessage({
              content: results[i] ?? "",
              tool_call_id: call.id ?? call.name,
            }),
        ),
      };
    }

    function routeAfterModel(state: typeof StateAnnotation.State) {
      if (state.done || state.rounds >= ctx.maxRounds) return END;
      return getToolCalls(state.messages.at(-1)).length > 0 ? "tools" : END;
    }

    const graph = new StateGraph(StateAnnotation)
      .addNode("model", callModel)
      .addNode("tools", callTools)
      .addEdge(START, "model")
      .addConditionalEdges("model", routeAfterModel)
      .addEdge("tools", "model")
      .compile();

    const result = await graph.invoke({
      messages: initialMessages,
      finalText: "",
      done: false,
      rounds: 0,
    });
    return { finalText: result.finalText ?? "", done: Boolean(result.done) };
  }

  /** Run one user turn, streaming events. Persists user + final answer to memory. */
  async function* run(sessionId: string, userText: string): AsyncGenerator<AgentEvent> {
    const activeSkillNames = new Set(memory.getActiveSkills(sessionId, allSkillNames));
    const activeSkills = allSkills.filter((skill) => activeSkillNames.has(skill.name));
    const mode = memory.getMode(sessionId);
    const thinking = memory.getThinking(sessionId);
    const parentSubagents = subagentsForMode(allSubagents, mode);
    const tools = buildTools(activeSkills, sessionId, {
      allowedTools: mode === "plan" ? PLAN_PARENT_TOOLS : undefined,
      subagents: parentSubagents,
    });
    const events = new EventQueue<AgentEvent>();

    memory.append(sessionId, new HumanMessage(userText));

    const initialMessages: BaseMessage[] = [
      new SystemMessage(parentSystemPrompt(activeSkills, parentSubagents, mode)),
      ...memory.getHistory(sessionId),
    ];

    const graphTask = (async () => {
      try {
        const result = await runLoop(
          {
            sessionId,
            skills: activeSkills,
            tools,
            persistFinal: true,
            events,
            mode,
            thinking,
            maxRounds: MAX_TOOL_ROUNDS,
          },
          initialMessages,
        );
        if (!result.done) events.push({ type: "done", text: result.finalText });
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
