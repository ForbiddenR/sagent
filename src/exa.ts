const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const MCP_PROTOCOL_VERSION = "2025-03-26";

type JsonRpcSuccess = { jsonrpc?: string; id?: unknown; result: unknown };
type JsonRpcFailure = {
  jsonrpc?: string;
  id?: unknown;
  error: { code?: number; message?: string; data?: unknown };
};
type JsonRpcMessage = JsonRpcSuccess | JsonRpcFailure;

let sessionId: string | undefined;
let initialized = false;
let nextRpcId = 1;
let rpcChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = rpcChain.then(fn, fn);
  rpcChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    ...extra,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const apiKey = process.env.EXA_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

function parseSseJsonRpc(body: string): JsonRpcMessage | undefined {
  let last: JsonRpcMessage | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      last = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      // ignore non-JSON SSE frames
    }
  }
  return last;
}

function parseMcpBody(contentType: string | null, body: string): JsonRpcMessage | undefined {
  if (contentType?.includes("text/event-stream")) return parseSseJsonRpc(body);
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as JsonRpcMessage;
}

function isJsonRpcFailure(msg: JsonRpcMessage | undefined): msg is JsonRpcFailure {
  return Boolean(msg && typeof msg === "object" && "error" in msg && msg.error);
}

function httpError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      detail?: string;
      title?: string;
    };
    const msg = parsed.error?.message || parsed.detail || parsed.title;
    if (msg) return new Error(`Exa MCP HTTP ${status}: ${msg}`);
  } catch {
    // fall through
  }
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 400);
  return new Error(snippet ? `Exa MCP HTTP ${status}: ${snippet}` : `Exa MCP HTTP ${status}`);
}

function isSessionError(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return /session/i.test(body);
}

function extractToolText(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);

  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n\n");
  }
  return JSON.stringify(result);
}

function resetSession() {
  sessionId = undefined;
  initialized = false;
}

async function postMcp(
  payload: unknown,
  { allowMissingSession = false }: { allowMissingSession?: boolean } = {},
): Promise<{ status: number; body: string; contentType: string | null; responseSessionId: string | null }> {
  const res = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: mcpHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  const responseSessionId = res.headers.get("mcp-session-id");
  if (responseSessionId) sessionId = responseSessionId;

  if (!res.ok) {
    if (!allowMissingSession && isSessionError(res.status, body)) {
      throw Object.assign(httpError(res.status, body), { sessionExpired: true });
    }
    throw httpError(res.status, body);
  }

  return {
    status: res.status,
    body,
    contentType: res.headers.get("content-type"),
    responseSessionId,
  };
}

async function ensureSession() {
  if (initialized && sessionId) return;

  const init = await postMcp(
    {
      jsonrpc: "2.0",
      id: nextRpcId++,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "sagent", version: "0.1.0" },
      },
    },
    { allowMissingSession: true },
  );

  const msg = parseMcpBody(init.contentType, init.body);
  if (isJsonRpcFailure(msg)) {
    throw new Error(msg.error.message || "Exa MCP initialize failed");
  }

  await postMcp(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { allowMissingSession: true },
  );
  initialized = true;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const rpc = async (): Promise<string> => {
    await ensureSession();
    const { body, contentType } = await postMcp({
      jsonrpc: "2.0",
      id: nextRpcId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const msg = parseMcpBody(contentType, body);
    if (!msg) return "Error: empty response from Exa MCP.";
    if (isJsonRpcFailure(msg)) {
      throw new Error(msg.error.message || `Exa MCP ${name} failed`);
    }
    return extractToolText((msg as JsonRpcSuccess).result);
  };

  try {
    return await rpc();
  } catch (err) {
    if ((err as { sessionExpired?: boolean }).sessionExpired) {
      resetSession();
      return await rpc();
    }
    throw err;
  }
}

export async function webSearchExa(query: string, numResults?: number): Promise<string> {
  const cleaned = query.trim();
  if (!cleaned) return "Error: search query is required.";

  const args: Record<string, unknown> = { query: cleaned };
  if (numResults !== undefined) args.numResults = numResults;

  return enqueue(() => callTool("web_search_exa", args));
}

export async function webFetchExa(urls: string[], maxCharacters?: number): Promise<string> {
  const cleaned = urls.map((u) => u.trim()).filter(Boolean);
  if (cleaned.length === 0) return "Error: at least one URL is required.";

  const args: Record<string, unknown> = { urls: cleaned };
  if (maxCharacters !== undefined) args.maxCharacters = maxCharacters;

  return enqueue(() => callTool("web_fetch_exa", args));
}
