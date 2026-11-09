import type { Attachment } from "./context/attachments";
export type Mode = "chat" | "agent";
export type Capability = boolean | "unknown";
export interface Capabilities {
  chat: Capability;
  tools: Capability;
  vision: Capability;
  reasoning: Capability;
  structuredOutput: Capability;
  contextLength?: number;
}
export interface Model {
  id: string;
  size?: number;
  parameterSize?: string;
  quantization?: string;
  capabilities: Capabilities;
}
export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
  thinking?: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  error?: boolean;
  attachments?: Attachment[];
  elapsedMs?: number;
  outcome?: "completed" | "stopped" | "failed";
}
export interface Activity {
  messageId?: string;
  id: string;
  label: string;
  status: "running" | "success" | "error" | "rejected";
  detail?: string;
  at: number;
}
export interface Change {
  path: string;
  before: string | null;
  after: string | null;
}
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model: string;
  provider: "ollama";
  mode: Mode;
  workspace?: string;
  activity: Activity[];
  changes: Change[];
}
export type ToolStrategy = "automatic" | "native" | "fallback" | "chat-only";
export interface ModelSettings {
  temperature?: number;
  contextLength?: number;
  maxTokens?: number;
  systemPrompt?: string;
  toolStrategy?: ToolStrategy;
}
export interface Settings {
  theme: "system" | "light" | "dark";
  defaultMode: Mode;
  ollamaUrl: string;
  defaultModel: string;
  temperature: number;
  contextLength: number;
  maxTokens: number;
  maxIterations: number;
  autoApply: boolean;
  terminalApproval: boolean;
  models: Record<string, ModelSettings>;
}
export interface SavedData {
  version: 1;
  conversations: Conversation[];
  settings: Settings;
  workspaceHistory: string[];
  activeId?: string;
}
export interface Entry {
  name: string;
  path: string;
  directory: boolean;
}
export interface Pending {
  id: string;
  kind: "WRITE" | "DELETE" | "COMMAND";
  path: string | null;
  before: string | null;
  after: string | null;
  command: { program: string; args: string[]; timeout_seconds: number } | null;
  workspace: string;
}
export interface TerminalRecord {
  id: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  duration?: number;
  running: boolean;
  waiting?: boolean;
  outcome?: "stopped" | "rejected" | "failed";
}
export const defaults: Settings = {
  theme: "system",
  defaultMode: "chat",
  ollamaUrl: "http://localhost:11434",
  defaultModel: "",
  temperature: 0.4,
  contextLength: 8192,
  maxTokens: 4096,
  maxIterations: 25,
  autoApply: false,
  terminalApproval: true,
  models: {},
};
export const unknownCapabilities = (): Capabilities => ({
  chat: "unknown",
  tools: "unknown",
  vision: "unknown",
  reasoning: "unknown",
  structuredOutput: "unknown",
});

export type OutputTab = "terminal" | "activity" | "problems" | "diff" | "git";
