import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatEvent, Session, Settings, Skill } from "./types";

export const api = {
  settings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  models: (settings: Settings) => invoke<string[]>("list_models", { settings }),
  sessions: () => invoke<Session[]>("list_sessions"),
  createSession: () => invoke<Session>("create_session"),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  clearSession: (id: string) => invoke<Session>("clear_session", { id }),
  compactSession: (id: string) => invoke<Session>("compact_session", { id }),
  skills: () => invoke<Skill[]>("list_skills"),
  saveSkill: (skill: Skill) => invoke<Skill>("save_skill", { skill }),
  deleteSkill: (name: string) => invoke<void>("delete_skill", { name }),
  toggleSkill: (sessionId: string, name: string, enabled: boolean) =>
    invoke<Session>("toggle_skill", { sessionId, name, enabled }),
  chat: (sessionId: string, message: string, onEvent: (event: ChatEvent) => void) => {
    const channel = new Channel<ChatEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("chat", { sessionId, message, onEvent: channel });
  },
};
