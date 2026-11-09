import {
  defaults,
  type Conversation,
  type Mode,
  type SavedData,
  type Settings,
} from "../types";
import { id, loadData, saveData } from "../native";
export function newConversation(
  mode: Mode,
  model: string,
  workspace?: string,
): Conversation {
  return {
    id: id(),
    title: mode === "chat" ? "New chat" : "New agent task",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model,
    provider: "ollama",
    mode,
    workspace,
    activity: [],
    changes: [],
  };
}
export async function hydrate(): Promise<SavedData> {
  const saved = await loadData();
  if (!saved)
    return {
      version: 1,
      conversations: [],
      settings: defaults,
      workspaceHistory: [],
    };
  if (saved.version !== 1 || !Array.isArray(saved.conversations))
    throw new Error(
      "Unsupported local history format. Original history has been preserved.",
    );
  return {
    ...saved,
    settings: {
      ...defaults,
      ...saved.settings,
      models: saved.settings.models ?? {},
    },
    conversations: saved.conversations.map((c) => ({
      ...c,
      changes: c.changes ?? [],
      activity: c.activity ?? [],
    })),
  };
}
export function generationSettings(s: Settings, model: string) {
  return {
    temperature: s.temperature,
    contextLength: s.contextLength,
    maxTokens: s.maxTokens,
    toolStrategy: "automatic" as const,
    ...s.models[model],
  };
}
let queue = Promise.resolve();
export function persist(data: SavedData): Promise<void> {
  const snapshot = structuredClone(data);
  const task = queue.catch(() => {}).then(() => saveData(snapshot));
  queue = task;
  return task;
}
