export interface PendingApproval {
  id: string;
  name: "run_bash";
  args?: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  toolDetails?: Record<string, unknown>[];
  skills?: string[];
  pendingApproval?: PendingApproval;
  completed?: boolean;
  error?: string;
  timeout?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  activeSkills: string[];
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

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args?: Record<string, unknown> }
  | { type: "skill"; name: string }
  | { type: "approval_request"; id: string; name: "run_bash"; args?: Record<string, unknown> }
  | { type: "approval_result"; id: string; approved: boolean }
  | { type: "done"; text: string }
  | { type: "timeout"; message: string }
  | { type: "error"; message: string };

export type SkillEditorState = { mode: "create" | "edit"; skill: Skill } | null;
