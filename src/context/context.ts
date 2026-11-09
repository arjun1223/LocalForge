import type { ModelMessage } from "../types";
import { completedToolSummary } from "./completedTools";

export interface ContextOptions {
  /** Native tool schemas consume prompt space even though they are not messages. */
  tools?: readonly unknown[];
  /** The real task, rather than a fallback protocol's synthetic user tool result. */
  task?: ModelMessage;
}
const CHARS_PER_TOKEN = 2.5;
const messageSize = (message: ModelMessage) =>
  JSON.stringify(message).length + 24;
export function contextSize(
  messages: readonly ModelMessage[],
  tools: readonly unknown[] = [],
) {
  return (
    messages.reduce((size, message) => size + messageSize(message), 0) +
    (tools.length ? JSON.stringify(tools).length : 0)
  );
}
export function contextBudget(contextLength: number, maxTokens: number) {
  // Keep the output reservation bounded, and leave space for runtime chat templates.
  return Math.floor(
    (contextLength -
      Math.min(maxTokens, contextLength / 2) -
      Math.min(256, contextLength / 8)) *
      CHARS_PER_TOKEN,
  );
}
function excerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  const head = Math.ceil(limit / 3);
  return `${text.slice(0, head)}\n[Context excerpt: middle omitted; request a targeted read for exact source.]\n${limit - head ? text.slice(-(limit - head)) : ""}`;
}
export function trimToolResult(content: string, limit: number) {
  if (content.length <= limit) return content;
  const metadata: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(content);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of [
        "path",
        "program",
        "exit_code",
        "duration_ms",
        "stopped",
        "applied",
        "rejected",
        "error",
      ]) {
        const field = (value as Record<string, unknown>)[key];
        if (
          typeof field === "boolean" ||
          typeof field === "number" ||
          field === null
        )
          metadata[key] = field;
        else if (typeof field === "string") metadata[key] = field.slice(0, 160);
      }
    }
  } catch {
    /* Fallback tool responses are labelled text, not bare JSON. */
  }
  return JSON.stringify({
    ...metadata,
    context_truncated: true,
    original_characters: content.length,
    excerpt: excerpt(content, limit),
  });
}
function isFallbackResult(message: ModelMessage) {
  return (
    message.role === "user" && message.content.startsWith("Tool result for ")
  );
}
function compactGroup(
  group: ModelMessage[],
  available: number,
): ModelMessage[] | undefined {
  const resize = (limit: number) =>
    group.map((message) => {
      // Private reasoning is optional history. Drop it before sacrificing source/results.
      const { thinking: _thinking, ...copy } = message;
      if (message.role === "tool")
        copy.content = trimToolResult(message.content, limit);
      else if (isFallbackResult(message)) {
        const colon = message.content.indexOf(": ");
        copy.content =
          message.content.slice(0, colon + 2) +
          trimToolResult(message.content.slice(colon + 2), limit);
      } else if (message.tool_calls?.length)
        copy.content = excerpt(message.content, limit);
      // Preserve tool names/arguments exactly, including fallback JSON call messages.
      return copy;
    });
  const size = (messages: ModelMessage[]) => contextSize(messages);
  if (size(resize(0)) > available) {
    const minimal = completedToolSummary(group, 0);
    if (!minimal || messageSize(minimal) > available) return undefined;
    let low = 0,
      high = 2000;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const summary = completedToolSummary(group, mid)!;
      if (messageSize(summary) <= available) low = mid;
      else high = mid - 1;
    }
    return [completedToolSummary(group, low)!];
  }
  let low = 0,
    high = Math.max(...group.map((message) => message.content.length));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (size(resize(mid)) <= available) low = mid;
    else high = mid - 1;
  }
  return resize(low);
}

/** Pure packing: retain call/result pairs, or replace a complete exchange with an explicit historical summary. Never mutate executable arguments or saved history. */
export function fitContext(
  messages: ModelMessage[],
  contextLength: number,
  maxTokens: number,
  options: ContextOptions = {},
): ModelMessage[] {
  const system = messages.filter((message) => message.role === "system");
  const turns = messages.filter((message) => message.role !== "system");
  const task =
    options.task ?? turns.filter((message) => message.role === "user").at(-1);
  const fixed = [...system, ...(task ? [task] : [])];
  const budget = contextBudget(contextLength, maxTokens);
  let available = budget - contextSize(fixed, options.tools);
  if (available < 0)
    throw new Error(
      "The task, system prompt, and tool definitions exceed the configured context budget. Reduce attached context or increase Context length in Settings.",
    );
  const groups: ModelMessage[][] = [];
  for (const message of turns) {
    if (message === task) {
      groups.push([message]);
      continue;
    }
    if (
      (message.role === "tool" || isFallbackResult(message)) &&
      groups.length &&
      groups[groups.length - 1][0].role === "assistant"
    )
      groups[groups.length - 1].push(message);
    else if (message.role !== "tool") groups.push([message]); // Never send orphan tool results.
  }
  const selected = new Map<number, ModelMessage[]>();
  let keptRecent = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i];
    if (group[0] === task) {
      selected.set(i, group);
      continue;
    }
    let packed: ModelMessage[] | undefined = group;
    if (contextSize(group) > available) {
      if (keptRecent || i !== groups.length - 1) break;
      packed = compactGroup(group, available);
      if (!packed)
        throw new Error(
          "The context budget cannot hold this unfinished tool exchange. Increase Context length in Settings or start a focused task. Completed edits remain saved.",
        );
    }
    selected.set(i, packed);
    available -= contextSize(packed);
    keptRecent = true;
  }
  // Keep the task even when older history was dropped before the loop reached it.
  const taskIndex = groups.findIndex((group) => group[0] === task);
  if (taskIndex >= 0) selected.set(taskIndex, [task!]);
  return [
    ...system,
    ...[...selected].sort(([a], [b]) => a - b).flatMap(([, group]) => group),
  ];
}
