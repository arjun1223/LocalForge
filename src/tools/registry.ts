import { z } from "zod";
import type { ToolDefinition } from "../providers/provider";
const path = z.string().min(1).max(4096);
const definitions = {
  list_directory: {
    description:
      'List one workspace directory. Start with path ".". Respects common generated directories and .gitignore.',
    schema: z.object({ path }).strict(),
  },
  read_file: {
    description:
      "Read a UTF-8 file inside the workspace (max 512 KiB). Prefer ranges for larger files.",
    schema: z.object({ path }).strict(),
  },
  read_file_range: {
    description: "Read a 1-based inclusive line range (at most 501 lines).",
    schema: z
      .object({
        path,
        start: z.number().int().min(1),
        end: z.number().int().min(1),
      })
      .strict(),
  },
  search_files: {
    description:
      "Find paths by case-insensitive substring, respecting .gitignore. Up to 150 results.",
    schema: z.object({ query: z.string().min(1).max(500) }).strict(),
  },
  find_text: {
    description:
      "Search text by literal case-insensitive substring. Returns file paths and line numbers.",
    schema: z.object({ query: z.string().min(1).max(500) }).strict(),
  },
  create_file: {
    description:
      "Propose creating a UTF-8 file. Parent folder must exist. Existing files cannot be replaced.",
    schema: z.object({ path, content: z.string().max(524288) }).strict(),
  },
  write_file: {
    description:
      "Propose replacing a file. Read current contents first. Prefer edit_file for targeted changes.",
    schema: z.object({ path, content: z.string().max(524288) }).strict(),
  },
  edit_file: {
    description:
      "Propose a targeted replacement. old_text must match exactly one occurrence in current file.",
    schema: z
      .object({
        path,
        old_text: z.string().min(1).max(524288),
        new_text: z.string().max(524288),
      })
      .strict(),
  },
  delete_file: {
    description:
      "Request approval to delete one text file. Directories are not supported.",
    schema: z.object({ path }).strict(),
  },
  run_terminal_command: {
    description:
      "Run a program with separate arguments in the workspace. No shell interpolation. Usually requires user approval. Run builds/tests, inspect failures, fix and repeat. timeout_seconds: 1–600.",
    schema: z
      .object({
        program: z.string().min(1).max(200),
        args: z.array(z.string().max(10000)).max(100),
        timeout_seconds: z.number().int().min(1).max(600).default(120),
      })
      .strict(),
  },
  git_status: {
    description: "Read Git status and current branch.",
    schema: z.object({}).strict(),
  },
  git_diff: {
    description:
      "Read actual unstaged and staged changes, including repositories without a first commit. Untracked file changes appear in the app change panel.",
    schema: z.object({}).strict(),
  },
  git_log: {
    description: "Read the last 12 Git commits.",
    schema: z.object({}).strict(),
  },
};
export type ToolName = keyof typeof definitions;
export function validateTool(
  name: string,
  args: unknown,
): Record<string, unknown> {
  if (!Object.hasOwn(definitions, name))
    throw new Error(`Unknown tool: ${name}`);
  return definitions[name as ToolName].schema.parse(args);
}
export const tools: ToolDefinition[] = Object.entries(definitions).map(
  ([name, d]) => ({
    type: "function",
    function: {
      name,
      description: d.description,
      parameters: z.toJSONSchema(d.schema, { target: "draft-7" }),
    },
  }),
);
export function parseFallback(
  content: string,
):
  | { type: "tool_call"; tool: string; arguments: Record<string, unknown> }
  | { type: "final"; content: string } {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
  const data: unknown = JSON.parse(text);
  const result = z
    .discriminatedUnion("type", [
      z
        .object({
          type: z.literal("tool_call"),
          tool: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        })
        .strict(),
      z.object({ type: z.literal("final"), content: z.string() }).strict(),
    ])
    .parse(data);
  if (result.type === "tool_call") validateTool(result.tool, result.arguments);
  return result;
}
