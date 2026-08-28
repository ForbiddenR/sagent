import http from "node:http";
import https from "node:https";
import { anthropicAuth } from "./agent.ts";

function envMs(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const CHAT_MODEL = process.env.MODEL || "claude-opus-4-8";
const TITLE_TIMEOUT_MS = envMs("TITLE_TIMEOUT_MS", 20_000);
const TITLE_MAX_CHARS = 50;

/** Cheap model first; on a gateway with no TITLE_MODEL, skip Haiku (it often 502s). */
function titleModels(): string[] {
  const explicit = process.env.TITLE_MODEL?.trim();
  const cheap = explicit || (process.env.ANTHROPIC_BASE_URL ? CHAT_MODEL : "claude-haiku-4-5");
  return [...new Set([cheap, CHAT_MODEL].filter(Boolean))];
}

const TITLE_SYSTEM = `You generate a short session title so the user can find this conversation later.
Output a JSON object and nothing else: {"title":"..."}

Rules:
- 3–7 words, sentence case, one line
- Same language as the user message
- MUST NOT copy the user message. Rewrite it as a noun phrase
- No quotes, markdown, or extra keys
- Keep filenames, numbers, and technical terms
- Greetings ("hello", "hi", "你好") → Greeting / 问候
- "what model are you" / "你是什么模型" → Model identity / 询问所用模型

Examples:
{"title": "Debugging production 500 errors"}
{"title": "Auth refresh token support"}
{"title": "问候"}
{"title": "询问所用模型"}`;

export function cleanTitle(raw: string) {
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  const unquoted = line.replace(/^["'`]+|["'`]+$/g, "").trim();
  const collapsed = unquoted.replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed.length > TITLE_MAX_CHARS ? collapsed.slice(0, TITLE_MAX_CHARS).trim() : collapsed;
}

function parseModelTitle(raw: string) {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as { title?: unknown };
      if (typeof obj.title === "string") return cleanTitle(obj.title);
    } catch {
      // fall through to first-line cleanup
    }
  }
  return cleanTitle(trimmed);
}

function normalizeForEcho(value: string) {
  return value.replace(/\s+/g, " ").replace(/[…。.!！?？]+$/g, "").trim().toLowerCase();
}

/** True when the model just echoed the prompt instead of naming the thread. */
function isEchoOfMessage(title: string, message: string) {
  const t = normalizeForEcho(title);
  const m = normalizeForEcho(message);
  if (!t || !m) return false;
  if (t === m) return true;
  if (m.length <= TITLE_MAX_CHARS + 8 && (m.startsWith(t) || t.startsWith(m))) return true;
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const rec = err as { message?: unknown };
    if (typeof rec.message === "string" && rec.message) return rec.message;
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return err == null ? "unknown error" : String(err);
}

function messagesUrl() {
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  return new URL(`${base}/v1/messages`);
}

/**
 * Direct POST /v1/messages on a one-shot TCP connection.
 *
 * OpenCode forks a hidden title agent; Claude Code / Codex fire a background
 * helper turn. None of them reuse the chat stream's HTTP socket. Bun's global
 * fetch pool is what produced "The socket connection was closed unexpectedly"
 * after the chat stream — so this path does not use fetch at all.
 */
function postMessages(body: unknown): Promise<unknown> {
  const { apiKey, authToken } = anthropicAuth();
  const url = messagesUrl();
  const payload = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "content-length": String(payload.byteLength),
    "anthropic-version": "2023-06-01",
    connection: "close",
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  const lib = url.protocol === "https:" ? https : http;
  const agent = url.protocol === "https:"
    ? new https.Agent({ keepAlive: false, maxSockets: 1 })
    : new http.Agent({ keepAlive: false, maxSockets: 1 });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      if (err !== undefined) reject(err instanceof Error ? err : new Error(errorMessage(err)));
      else resolve(value);
    };

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("error", (err) => finish(err ?? new Error("title response error")));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 502;
          if (status >= 400) {
            finish(new Error(`${status} ${text}`));
            return;
          }
          try {
            finish(undefined, JSON.parse(text));
          } catch {
            finish(new Error(`Invalid title response: ${text.slice(0, 200)}`));
          }
        });
      },
    );

    req.on("error", (err) => finish(err ?? new Error("title request error")));
    req.setTimeout(TITLE_TIMEOUT_MS, () => {
      req.destroy();
      finish(new Error(`Title request timed out after ${TITLE_TIMEOUT_MS}ms`));
    });
    req.end(payload);
  });
}

function extractStopReason(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const rec = data as { stop_reason?: unknown; stopReason?: unknown };
  if (typeof rec.stop_reason === "string") return rec.stop_reason;
  if (typeof rec.stopReason === "string") return rec.stopReason;
  return "";
}

function extractResponseText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const rec = data as Record<string, unknown>;
  if (rec.error) {
    throw new Error(errorMessage(rec.error));
  }
  if (typeof rec.output_text === "string") return rec.output_text;
  if (typeof rec.content === "string") return rec.content;
  if (Array.isArray(rec.content)) {
    return rec.content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          return block.text;
        }
        return "";
      })
      .join("");
  }
  const choices = rec.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const choice = choices[0] as { message?: { content?: unknown }; text?: unknown };
    const content = choice.message?.content ?? choice.text;
    if (typeof content === "string") return content;
  }
  return "";
}

function isRetryableTitleError(err: unknown): boolean {
  const msg = errorMessage(err);
  const status = /^\s*(\d{3})\b/.exec(msg)?.[1];
  if (status === "400" || status === "404" || status === "502" || status === "503") return true;
  return /upstream_unavailable|socket connection was closed|connection.*closed|econnreset|econnrefused|etimedout|fetch failed|network|model.?not.?found|does not exist|unknown model|invalid.?model|not_found_error|temperature|thinking|effort/i.test(msg);
}

function acceptsTemperature(model: string) {
  return /haiku|claude-3/i.test(model);
}

type TitleAttempt = {
  max_tokens: number;
  thinking?: { type: "disabled" };
  temperature?: number;
  output_config?: { effort: "low" };
};

function attemptsFor(model: string): TitleAttempt[] {
  const haiku = acceptsTemperature(model);
  // Fable 5 400s on thinking.disabled — omit the field and keep max_tokens high
  // enough for always-on thinking. Opus 4.8 omits thinking = off; Sonnet 5
  // omits thinking = adaptive, so send disabled explicitly.
  if (/fable|mythos/i.test(model)) {
    return [
      { max_tokens: 1024, output_config: { effort: "low" } },
      { max_tokens: 2048 },
    ];
  }
  return [
    { max_tokens: 256, thinking: { type: "disabled" }, ...(haiku ? { temperature: 0.5 } : {}) },
    { max_tokens: 1024, output_config: { effort: "low" } },
    { max_tokens: 1024 },
  ];
}

async function requestTitle(model: string, prompt: string, extra: TitleAttempt) {
  const response = await postMessages({
    model,
    stream: false,
    system: TITLE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    ...extra,
  });
  const raw = extractResponseText(response);
  return {
    title: parseModelTitle(raw),
    raw,
    stopReason: extractStopReason(response),
  };
}

function warnTitle(err: unknown) {
  console.warn(`⚠️  Session title generation failed: ${errorMessage(err)}`);
}

/**
 * Cheap, no-tools title from the first user message.
 * Returns undefined on failure so the placeholder title is kept — never the raw prompt.
 */
export async function generateSessionTitle(message: string): Promise<string | undefined> {
  const { apiKey, authToken } = anthropicAuth();
  if (!apiKey && !authToken) return undefined;

  const models = titleModels();
  const prompt = `Generate a title for this conversation:\n\n<user_message>\n${message.slice(0, 2000)}\n</user_message>`;
  let lastError: unknown;

  for (const model of models) {
    for (const extra of attemptsFor(model)) {
      try {
        const { title, raw, stopReason } = await requestTitle(model, prompt, extra);
        if (title && !isEchoOfMessage(title, message)) return title;
        if (title) {
          lastError = new Error(`title echoed the user message: ${title}`);
          continue;
        }
        lastError = new Error(
          `empty title from ${model}${stopReason ? ` (stop_reason=${stopReason})` : ""}${raw ? ` raw=${raw.slice(0, 80)}` : ""}`,
        );
      } catch (err) {
        lastError = err;
        if (!isRetryableTitleError(err)) {
          warnTitle(err);
          return undefined;
        }
      }
    }
  }

  if (lastError) warnTitle(lastError);
  return undefined;
}
