export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  toolDetails?: Record<string, unknown>[];
  skills?: string[];
  completed?: boolean;
  error?: string;
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
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export type SkillEditorState = { mode: "create" | "edit"; skill: Skill } | null;
