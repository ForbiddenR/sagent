export interface PendingApproval {
  id: string;
  name: "run_bash";
  args?: Record<string, unknown>;
}

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

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  toolDetails?: Record<string, unknown>[];
  skills?: string[];
  subagents?: SubagentRun[];
  pendingApprovals?: PendingApproval[];
  completed?: boolean;
  error?: string;
  timeout?: boolean;
}

export type SessionMode = "build" | "plan";
export type ThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh", "max"];

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeSkills: string[];
  mode: SessionMode;
  thinking: ThinkingLevel;
}

export interface SessionFile {
  name: string;
  size: number;
  modified: string;
  isDir: boolean;
}

export interface SkillSummary {
  name: string;
  description: string;
}

export interface Skill extends SkillSummary {
  body: string;
}

export interface SubagentSummary {
  name: string;
  description: string;
  tools?: string[];
}

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
  | { type: "mode"; mode: SessionMode }
  | { type: "done"; text: string }
  | { type: "timeout"; message: string }
  | { type: "error"; message: string };

export type SkillEditorState = { mode: "create" | "edit"; skill: Skill } | null;
