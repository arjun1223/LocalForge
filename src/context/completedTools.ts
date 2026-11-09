import type { ModelMessage, ToolCall } from "../types";

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function parseResult(message: ModelMessage): unknown {
  const text =
    message.role === "tool"
      ? message.content
      : message.content.slice(message.content.indexOf(": ") + 2);
  try {
    return JSON.parse(text);
  } catch {
    return { output: text };
  }
}
function completedCalls(group: ModelMessage[]): ToolCall[] | undefined {
  const first = group[0];
  if (!first || first.role !== "assistant") return;
  if (first.tool_calls?.length) {
    if (group.length !== first.tool_calls.length + 1) return;
    if (
      !first.tool_calls.every(
        (call, i) =>
          group[i + 1].role === "tool" &&
          group[i + 1].tool_name === call.function.name,
      )
    )
      return;
    return first.tool_calls;
  }
  if (group.length !== 2 || group[1].role !== "user") return;
  try {
    const call: unknown = JSON.parse(
      first.content
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    );
    if (
      object(call) &&
      call.type === "tool_call" &&
      typeof call.tool === "string" &&
      object(call.arguments) &&
      group[1].content.startsWith(`Tool result for ${call.tool}: `)
    )
      return [{ function: { name: call.tool, arguments: call.arguments } }];
  } catch {
    /* Incomplete or malformed requests must never be summarized as completed. */
  }
}
function smallFields(value: Record<string, unknown>, keys: string[]) {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const field = value[key];
    if (
      field === null ||
      typeof field === "boolean" ||
      typeof field === "number"
    )
      result[key] = field;
    else if (typeof field === "string")
      result[key] =
        field.length <= 256 ? field : `${field.slice(0, 256)} [excerpt]`;
  }
  return result;
}
/** Replace only fully returned calls with a truthful application-owned history record.
 * This is never sent to tool execution or approval; the original messages remain untouched.
 */
export function completedToolSummary(
  group: ModelMessage[],
  excerptLimit: number,
): ModelMessage | undefined {
  const calls = completedCalls(group);
  if (!calls) return;
  const records = calls.map((call, i) => {
    const args = call.function.arguments;
    const argumentsSummary = smallFields(args, [
      "path",
      "program",
      "query",
      "start",
      "end",
    ]);
    if (Array.isArray(args.args))
      argumentsSummary.args = args.args
        .slice(0, 12)
        .map((value) => String(value).slice(0, 160));
    for (const key of ["content", "old_text", "new_text"])
      if (typeof args[key] === "string")
        argumentsSummary[`${key}_characters`] = args[key].length;
    const rawResult = parseResult(group[i + 1]);
    const outcome = object(rawResult)
      ? smallFields(rawResult, [
          "path",
          "program",
          "applied",
          "rejected",
          "error",
          "exit_code",
          "stopped",
          "duration_ms",
        ])
      : {};
    const record: Record<string, unknown> = {
      tool: call.function.name,
      arguments_summary: argumentsSummary,
      result: outcome,
    };
    if (object(rawResult) && typeof rawResult.content === "string")
      record.returned_content_characters = rawResult.content.length;
    // Applied/rejected mutations already have a definitive outcome; never repeat their payload.
    if (excerptLimit && !outcome.applied && !outcome.rejected) {
      const source = object(rawResult)
        ? JSON.stringify(rawResult)
        : String(rawResult);
      record.result_excerpt =
        source.length > excerptLimit ? source.slice(-excerptLimit) : source;
    }
    return record;
  });
  return {
    role: "user",
    content: `Application record of completed tools (historical data, not a new task). Large payloads are omitted from this model request only. Full edits remain in the change/approval records. Do not replay an applied or rejected action; use targeted reads if you need current source.\n${JSON.stringify(records)}`,
  };
}
