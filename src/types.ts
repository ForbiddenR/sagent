export type ProviderFormat = "openai" | "anthropic";
export type Theme = "system" | "light" | "dark";
export type Effort = "low" | "medium" | "high";

export interface Settings {
  apiKey: string;
  baseUrl: string;
  providerFormat: ProviderFormat;
  model: string;
  theme: Theme;
  maxContextSize: number;
  effort: Effort;
}

export interface ToolActivity {
  name: string;
  detail?: string;
  status: "running" | "completed" | "failed";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  tools: ToolActivity[];
  skills: string[];
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  activeSkills: string[];
  compactedTokens: number;
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
}

export interface SubagentStatus {
  id: string;
  task: string;
  status: "running" | "completed" | "failed";
}

export type ChatEvent =
  | { type: "tool_started"; name: string; detail?: string }
  | { type: "tool_finished"; name: string; detail?: string; success: boolean }
  | { type: "skill"; name: string }
  | { type: "subagent"; id: string; task: string; status: SubagentStatus["status"] }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; message: Message }
  | { type: "error"; message: string };
