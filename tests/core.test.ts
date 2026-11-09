import { describe, expect, it, vi } from "vitest";
import { capabilitiesFromInfo, NdjsonParser } from "../src/providers/ollama";
import { parseFallback, validateTool } from "../src/tools/registry";
import { fitContext } from "../src/context/context";
import { parseCommand } from "../src/tools/command";
import { AgentUnsupportedError, runAgent } from "../src/agent/orchestrator";
import type {
  LocalModelProvider,
  ChatResponse,
} from "../src/providers/provider";
import type { Activity } from "../src/types";

describe("model-agnostic discovery and streaming", () => {
  it("does not invent capabilities or depend on model names", () => {
    expect(capabilitiesFromInfo({}).tools).toBe("unknown");
    expect(
      capabilitiesFromInfo({
        capabilities: ["completion", "vision"],
        model_info: { "arbitrary.context_length": 16384 },
      }),
    ).toMatchObject({
      chat: true,
      tools: false,
      vision: true,
      reasoning: false,
      structuredOutput: "unknown",
      contextLength: 16384,
    });
  });
  it("assembles split NDJSON frames and the final unterminated frame", () => {
    const frames: unknown[] = [];
    const parser = new NdjsonParser((v) => frames.push(v));
    parser.push('{"message":');
    parser.push('{"content":"hello"}}\n{"done":');
    parser.push("true}");
    parser.finish();
    expect(frames).toEqual([{ message: { content: "hello" } }, { done: true }]);
  });
});
describe("untrusted model output", () => {
  it("requires a registered tool and strict arguments", () => {
    expect(() => validateTool("eval", { code: "bad" })).toThrow();
    expect(() =>
      validateTool("read_file", { path: "a", extra: "ignored?" }),
    ).toThrow();
    expect(() =>
      validateTool("run_terminal_command", { program: "npm", args: "test" }),
    ).toThrow();
  });
  it("parses structured fallback without executing surrounding prose", () => {
    expect(
      parseFallback(
        '```json\n{"type":"tool_call","tool":"read_file","arguments":{"path":"src/a.ts"}}\n```',
      ).type,
    ).toBe("tool_call");
    expect(() => parseFallback('Run this: {"type":"tool_call"}')).toThrow();
    expect(() =>
      parseFallback('{"type":"tool_call","tool":"shell","arguments":{}}'),
    ).toThrow();
  });
  it("tokenizes arguments without shell evaluation", () => {
    expect(parseCommand('python3 -c "print(123)"')).toEqual({
      program: "python3",
      args: ["-c", "print(123)"],
    });
    expect(parseCommand('echo "$(whoami)"')).toEqual({
      program: "echo",
      args: ["$(whoami)"],
    });
    expect(() => parseCommand("npm test && rm x")).toThrow();
    expect(() => parseCommand('echo "unclosed')).toThrow();
  });
  it("preserves native tool call/result pairs when trimming context", () => {
    const history = [
      { role: "system" as const, content: "system" },
      { role: "user" as const, content: "task" },
      ...Array.from({ length: 10 }, (_, i) => [
        {
          role: "assistant" as const,
          content: "",
          tool_calls: [
            { function: { name: "read_file", arguments: { path: String(i) } } },
          ],
        },
        {
          role: "tool" as const,
          tool_name: "read_file",
          content: "x".repeat(3000),
        },
      ]).flat(),
    ];
    const result = fitContext(history, 8192, 4096);
    expect(result[0].role).toBe("system");
    for (let i = 1; i < result.length; i++)
      if (result[i].role === "tool")
        expect(result[i - 1].role).toBe("assistant");
    expect(result.length).toBeLessThan(history.length);
  });
});
function provider(responses: ChatResponse[]): LocalModelProvider {
  return {
    id: "test",
    listModels: vi.fn(),
    getModelInfo: vi.fn(),
    getCapabilities: vi.fn(),
    supportsTools: vi.fn(),
    supportsVision: vi.fn(),
    chat: vi.fn(),
    cancelGeneration: vi.fn(),
    streamChat: vi.fn(async (_request, onText) => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected extra model request");
      if (response.content) onText(response.content);
      return response;
    }),
  };
}
const response = (
  name: string,
  args: Record<string, unknown>,
): ChatResponse => ({
  content: "",
  toolCalls: [{ function: { name, arguments: args } }],
});
describe("iterative coding orchestration", () => {
  it("observes a failed build, waits for an approved edit, rebuilds and reports success", async () => {
    const p = provider([
      response("run_terminal_command", {
        program: "npm",
        args: ["run", "build"],
      }),
      response("read_file", { path: "src/index.ts" }),
      response("edit_file", {
        path: "src/index.ts",
        old_text: "bad",
        new_text: "good",
      }),
      response("run_terminal_command", {
        program: "npm",
        args: ["run", "build"],
      }),
      { content: "Fixed and verified.", toolCalls: [] },
    ]);
    const actions: string[] = [];
    const activity: Activity[] = [];
    let build = 0;
    let approved = false;
    const final = await runAgent({
      provider: p,
      model: "arbitrary-local-model",
      options: {},
      messages: [{ role: "user", content: "Fix build" }],
      workspace: "/fixture",
      maxIterations: 10,
      nativeTools: true,
      signal: new AbortController().signal,
      onText: () => {},
      onResetText: () => {},
      onActivity: (a) => activity.push(a),
      execute: async (name) => {
        actions.push(name);
        if (name === "run_terminal_command")
          return { exit_code: build++ === 0 ? 1 : 0 };
        if (name === "edit_file") {
          await Promise.resolve();
          approved = true;
          return { applied: true };
        }
        return { content: "bad" };
      },
    });
    expect(final).toBe("Fixed and verified.");
    expect(approved).toBe(true);
    expect(actions).toEqual([
      "run_terminal_command",
      "read_file",
      "edit_file",
      "run_terminal_command",
    ]);
    expect(
      activity.some(
        (a) => a.label === "run_terminal_command" && a.status === "error",
      ),
    ).toBe(true);
  });
  it("supports fallback tool turns and disables unreliable protocol responses", async () => {
    const p = provider([
      {
        content:
          '{"type":"tool_call","tool":"list_directory","arguments":{"path":"."}}',
        toolCalls: [],
      },
      { content: '{"type":"final","content":"Inspected"}', toolCalls: [] },
    ]);
    const base = {
      model: "any-model",
      options: {},
      messages: [{ role: "user" as const, content: "Inspect" }],
      workspace: "/fixture",
      maxIterations: 4,
      nativeTools: false,
      signal: new AbortController().signal,
      onText: vi.fn(),
      onResetText: vi.fn(),
      onActivity: vi.fn(),
      execute: vi.fn(async () => ({ entries: [] })),
    };
    expect(await runAgent({ ...base, provider: p })).toBe("Inspected");
    expect(base.execute).toHaveBeenCalledWith("list_directory", { path: "." });
    const broken = provider([
      { content: "raw shell text", toolCalls: [] },
      { content: "still wrong", toolCalls: [] },
    ]);
    await expect(
      runAgent({ ...base, provider: broken }),
    ).rejects.toBeInstanceOf(AgentUnsupportedError);
  });
  it("enforces cancellation and iteration limits", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const base = {
      provider: provider([]),
      model: "any",
      options: {},
      messages: [],
      workspace: "/fixture",
      maxIterations: 1,
      nativeTools: true,
      signal: ctrl.signal,
      onText: vi.fn(),
      onResetText: vi.fn(),
      onActivity: vi.fn(),
      execute: vi.fn(async () => ({})),
    };
    await expect(runAgent(base)).rejects.toThrow();
    expect(base.execute).not.toHaveBeenCalled();
    await expect(
      runAgent({
        ...base,
        signal: new AbortController().signal,
        provider: provider([response("list_directory", { path: "." })]),
      }),
    ).rejects.toThrow("iteration limit");
  });
});
