import type { ModelMessage, ModelSettings } from "../types";
import { fitContext } from "./context";
export function chatMessages(
  history: ModelMessage[],
  options: ModelSettings,
  workspace?: string,
): ModelMessage[] {
  const modePrompt =
    "You are LocalForge in Chat mode. Chat has no filesystem, search, editing, or terminal tools. Only discuss content provided in this conversation or explicitly attached by the user." +
    (workspace
      ? ` A project is selected in the app: ${JSON.stringify(workspace)}. Selecting it does not grant Chat access. If the user asks you to inspect, debug, build, or edit that project, tell them to choose Code Agent (or click Use Code Agent) and submit the project task there. Do not ask them to paste the repository as the way to enable project access.`
      : " For hands-on project work, tell the user to open a workspace and choose Code Agent.") +
    " Never claim to have inspected files or run commands in Chat mode. Use clear Markdown when useful.";
  return fitContext(
    [
      {
        role: "system",
        content: `${modePrompt}${options.systemPrompt ? `\nAdditional preferences: ${options.systemPrompt}` : ""}`,
      },
      ...history,
    ],
    options.contextLength ?? 8192,
    options.maxTokens ?? 4096,
  );
}
