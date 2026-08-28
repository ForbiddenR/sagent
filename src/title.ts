import { Anthropic } from "@anthropic-ai/sdk";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

function anthropicAuth() {
  const apiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || undefined;
  return { apiKey, authToken };
}

const TITLE_MODEL = process.env.TITLE_MODEL || "claude-haiku-4-5";
const TITLE_TIMEOUT_MS = Number(process.env.TITLE_TIMEOUT_MS ?? "8000");
const TITLE_MAX_CHARS = 50;

const TITLE_SYSTEM = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.
Your output must be:
- A single line
- ≤${TITLE_MAX_CHARS} characters
- No explanations, quotes, or punctuation wrapping
</task>

<rules>
- Use the same language as the user message
- Title must be grammatically correct and read naturally
- Never include tool names
- Focus on the main topic or question the user needs to retrieve
- Vary phrasing — avoid always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove filler: the, this, my, a, an
- Never assume a tech stack
- NEVER respond to the question; only generate a title
- Never include "summarizing" or "generating"
- Always output something meaningful, even if the input is minimal
- Short greetings ("hello", "hey") → Greeting / Quick check-in
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`;

export function titleFromMessage(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
}

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

function titleChat() {
  const { apiKey, authToken } = anthropicAuth();
  if (!apiKey && !authToken) {
    throw new Error("Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is set.");
  }
  return new ChatAnthropic({
    model: TITLE_MODEL,
    maxTokens: 64,
    temperature: 0.5,
    // No adaptive thinking / effort — those leak onto small models and break title calls.
    ...(apiKey
      ? { apiKey }
      : {
          createClient: (options: ConstructorParameters<typeof Anthropic>[0]) =>
            new Anthropic({
              ...options,
              apiKey: options?.apiKey ?? null,
              authToken: options?.authToken ?? authToken,
            }),
        }),
    ...(process.env.ANTHROPIC_BASE_URL ? { anthropicApiUrl: process.env.ANTHROPIC_BASE_URL } : {}),
  });
}

function extractOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

/** Cheap, no-tools title from the first user message. Falls back to a truncated prompt. */
export async function generateSessionTitle(message: string): Promise<string> {
  const fallback = titleFromMessage(message) || "New session";
  const { apiKey, authToken } = anthropicAuth();
  if (!apiKey && !authToken) return fallback;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TITLE_TIMEOUT_MS);
  try {
    const result = await titleChat().invoke(
      [
        new SystemMessage(TITLE_SYSTEM),
        new HumanMessage(
          `Generate a title for this conversation:\n\n<user_message>\n${message.slice(0, 2000)}\n</user_message>`,
        ),
      ],
      { signal: ac.signal },
    );
    return cleanTitle(extractOutput(result.content)) || fallback;
  } catch (err) {
    console.warn(`⚠️  Session title generation failed: ${(err as Error).message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
