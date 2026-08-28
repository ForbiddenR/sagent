import type { Skill } from "./types";

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export type SessionGroup = "today" | "yesterday" | "earlier";

export function sessionGroup(iso: string, now = new Date()): SessionGroup {
  const date = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return "today";
  if (date >= startYesterday) return "yesterday";
  return "earlier";
}

export function formatSessionTime(iso: string, now = new Date()) {
  const group = sessionGroup(iso, now);
  if (group === "today") return formatTime(iso);
  if (group === "yesterday") return "Yesterday";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function blankSkill(): Skill {
  return { name: "", description: "", body: "# New skill\n\nWrite instructions here." };
}
