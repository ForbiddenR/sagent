import { ChatAnthropic } from "@langchain/anthropic";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  type AIMessageChunk,
  type MessageContent,
} from "@langchain/core/messages";
import { memory } from "./memory.ts";
import { buildTools } from "./tools.ts";
import { renderSkillIndex, type Skill } from "./skills.ts";

const MODEL = process.env.MODEL || "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;
const TOP_P = Number(process.env.TOP_P ?? "1");
// Max seconds to wait for the next chunk from the model before treating the
// request as stalled/timed out. A long generation that keeps streaming is fine;
// only a complete silence for this long trips the timeout.
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

/** Events streamed out of the agent as it works. */
export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "skill"; name: string }
  | { type: "done"; text: string }
  | { type: "timeout"; message: string }
  | { type: "error"; message: string };

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

export function createAgent(allSkills: Skill[]) {
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
      "Be concise. Show your final answer clearly.",
    ].join("\n");
  }

  /** Run one user turn, streaming events. Persists user + final answer to memory. */
  async function* run(sessionId: string, userText: string): AsyncGenerator<AgentEvent> {
    const activeSkillNames = new Set(memory.getActiveSkills(sessionId, allSkillNames));
    const activeSkills = allSkills.filter((skill) => activeSkillNames.has(skill.name));
    const tools = buildTools(activeSkills, sessionId);
    const toolsByName = new Map(tools.map((t) => [t.name, t]));

    memory.append(sessionId, new HumanMessage(userText));

    // Working transcript for this turn: system + persisted history.
    // Intermediate tool_use / tool_result messages stay local (not persisted),
    // keeping stored memory to clean user/assistant text pairs.
    const working = [new SystemMessage(systemPrompt(activeSkills)), ...memory.getHistory(sessionId)];

    try {
      const model = llm(activeSkills, sessionId);
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Abort the underlying fetch if the model stalls, so we don't hang on
        // an unreachable / wedged API endpoint indefinitely.
        const controller = new AbortController();
        const stream = model.stream(working, { signal: controller.signal });

        let gathered: AIMessageChunk | undefined;
        for await (const chunk of withStallTimeout(stream as Promise<AsyncIterable<AIMessageChunk>>, MODEL_TIMEOUT_MS, () => controller.abort())) {
          gathered = gathered === undefined ? chunk : gathered.concat(chunk);
          const text = extractText(chunk.content);
          if (text) yield { type: "token", text };
        }
        if (!gathered) break;

        working.push(gathered);
        const toolCalls = gathered.tool_calls ?? [];

        if (toolCalls.length === 0) {
          // Final answer for this turn — persist just the text.
          const finalText = extractText(gathered.content);
          memory.append(sessionId, new AIMessage(finalText));
          yield { type: "done", text: finalText };
          return;
        }

        // Execute each requested tool and feed results back.
        for (const call of toolCalls) {
          if (call.name === "load_skill") {
            const skillName = typeof call.args?.name === "string" ? call.args.name : "unknown";
            yield { type: "skill", name: skillName };
          } else {
            yield { type: "tool", name: call.name, args: call.args as Record<string, unknown> };
          }
          const selected = toolsByName.get(call.name);
          const result = selected
            ? String(await selected.invoke(call.args))
            : `Error: unknown or disabled tool "${call.name}"`;
          working.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
        }
      }

      // Hit the tool-round cap without a final text answer.
      yield { type: "done", text: "" };
    } catch (err) {
      if (isTimeoutLikeError(err)) {
        yield { type: "timeout", message: TIMEOUT_HINT };
      } else {
        yield { type: "error", message: (err as Error).message };
      }
    }
  }

  return { run };
}

export type Agent = ReturnType<typeof createAgent>;
