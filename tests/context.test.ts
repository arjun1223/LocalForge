import { describe, expect, it, vi } from "vitest";
import { contextBudget, contextSize, fitContext } from "../src/context/context";
import { runAgent } from "../src/agent/orchestrator";
import { tools } from "../src/tools/registry";
import type { ModelMessage } from "../src/types";
import type {
  LocalModelProvider,
  ChatResponse,
} from "../src/providers/provider";

function multiRead(): ModelMessage[] {
  const calls = ["Sidebar", "Topbar", "MessageList"].map((name) => ({
    function: {
      name: "read_file",
      arguments: { path: `src/components/${name}.tsx` },
    },
  }));
  return [
    {
      role: "system",
      content: "Inspect first, make targeted edits, verify builds. ".repeat(20),
    },
    {
      role: "user",
      content: "Take a look at the codebase, fix any bugs, make the ui nice",
    },
    {
      role: "assistant",
      content: "Inspecting three relevant files.",
      thinking: "private reasoning ".repeat(2000),
      tool_calls: calls,
    },
    ...calls.map((call) => ({
      role: "tool" as const,
      tool_name: "read_file",
      content: JSON.stringify({
        path: call.function.arguments.path,
        content: 'const x = "source line";\n'.repeat(1200),
      }),
    })),
  ];
}
describe("context budget regression", () => {
  it.each([8192, 9216])(
    "fits multiple large file reads at %i tokens without losing call/result pairing",
    (context) => {
      const messages = multiRead();
      const snapshot = structuredClone(messages);
      const fitted = fitContext(messages, context, 4096, { tools });
      expect(contextSize(fitted, tools)).toBeLessThanOrEqual(
        contextBudget(context, 4096),
      );
      expect(fitted[0]).toEqual(messages[0]);
      expect(fitted[1]).toEqual(messages[1]);
      expect(fitted[2].tool_calls).toEqual(messages[2].tool_calls);
      expect(fitted.filter((m) => m.role === "tool")).toHaveLength(3);
      expect(fitted[2].thinking).toBeUndefined();
      for (const message of fitted.filter((m) => m.role === "tool")) {
        const result = JSON.parse(message.content);
        expect(result.context_truncated).toBe(true);
        expect(result.path).toMatch(/^src\/components/);
        expect(result.excerpt).toContain("source");
      }
      expect(messages).toEqual(snapshot);
    },
  );
  it("preserves command failures and useful output from a large result", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "Fix the build" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "run_terminal_command",
              arguments: { program: "npm", args: ["run", "build"] },
            },
          },
        ],
      },
      {
        role: "tool",
        tool_name: "run_terminal_command",
        content: JSON.stringify({
          program: "npm",
          exit_code: 1,
          stopped: false,
          stdout: "log ".repeat(50000),
          stderr: "src/example.ts:12: Type mismatch",
        }),
      },
    ];
    const fitted = fitContext(messages, 8192, 4096, { tools });
    const result = JSON.parse(fitted.at(-1)!.content);
    expect(result.exit_code).toBe(1);
    expect(result.stopped).toBe(false);
    expect(result.excerpt).toContain("Type mismatch");
    expect(contextSize(fitted, tools)).toBeLessThanOrEqual(
      contextBudget(8192, 4096),
    );
  });
  it("pins the original task when fallback results use the user role", () => {
    const task: ModelMessage = { role: "user", content: "Review the source" };
    const call: ModelMessage = {
      role: "assistant",
      content:
        '{"type":"tool_call","tool":"read_file","arguments":{"path":"a.ts"}}',
    };
    const fitted = fitContext(
      [
        { role: "system", content: "Strict JSON only" },
        task,
        call,
        {
          role: "user",
          content: `Tool result for read_file: ${JSON.stringify({ path: "a.ts", content: "source ".repeat(10000) })}`,
        },
      ],
      8192,
      4096,
      { task },
    );
    expect(fitted[1]).toBe(task);
    expect(fitted[2]).toEqual(call);
    expect(fitted[3].content).toMatch(/^Tool result for read_file: /);
    expect(fitted[3].content).toContain("context_truncated");
    expect(contextSize(fitted)).toBeLessThanOrEqual(contextBudget(8192, 4096));
  });
  it("drops oversized older chat history while preserving the new prompt", () => {
    const task: ModelMessage = { role: "user", content: "A short follow-up" };
    const fitted = fitContext(
      [
        { role: "system", content: "system" },
        { role: "assistant", content: "previous response ".repeat(10000) },
        task,
      ],
      8192,
      4096,
    );
    expect(fitted).toEqual([{ role: "system", content: "system" }, task]);
  });
  it("still rejects genuinely oversized prompts and incomplete tool calls", () => {
    expect(() =>
      fitContext(
        [
          { role: "system", content: "system" },
          { role: "user", content: "x".repeat(60000) },
        ],
        8192,
        4096,
      ),
    ).toThrow("task, system prompt");
    expect(() =>
      fitContext(
        [
          { role: "system", content: "system" },
          { role: "user", content: "edit" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "write_file",
                  arguments: { path: "x", content: "x".repeat(60000) },
                },
              },
            ],
          },
        ],
        8192,
        4096,
      ),
    ).toThrow("unfinished tool exchange");
  });
  it("counts native schemas and preserves long tool-call arguments exactly when they fit", () => {
    const task: ModelMessage = { role: "user", content: "Fix it" };
    const call: ModelMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "edit_file",
            arguments: {
              path: "x",
              old_text: "old ".repeat(200),
              new_text: "new",
            },
          },
        },
      ],
    };
    const result = fitContext(
      [
        { role: "system", content: "system" },
        task,
        call,
        {
          role: "tool",
          tool_name: "edit_file",
          content: JSON.stringify({
            applied: true,
            after: "new ".repeat(10000),
          }),
        },
      ],
      8192,
      4096,
      { tools },
    );
    expect(result[2].tool_calls).toEqual(call.tool_calls);
    expect(contextSize(result, tools)).toBeLessThanOrEqual(
      contextBudget(8192, 4096),
    );
  });
  it("continues a real orchestrator turn after a batch of large reads", async () => {
    const calls = multiRead()[2].tool_calls!;
    const replies: ChatResponse[] = [
      {
        content: "Inspect files",
        thinking: "reasoning ".repeat(3000),
        toolCalls: calls,
      },
      { content: "Inspection complete.", toolCalls: [] },
    ];
    const stream = vi.fn(async (request, onText) => {
      expect(contextSize(request.messages, request.tools)).toBeLessThanOrEqual(
        contextBudget(8192, 4096),
      );
      const response = replies.shift()!;
      onText(response.content);
      return response;
    });
    const provider = { streamChat: stream } as unknown as LocalModelProvider;
    const result = await runAgent({
      provider,
      model: "arbitrary-model",
      options: { contextLength: 8192, maxTokens: 4096 },
      messages: [{ role: "user", content: "Inspect this project" }],
      workspace: "/fixture",
      maxIterations: 3,
      nativeTools: true,
      signal: new AbortController().signal,
      onText: vi.fn(),
      onResetText: vi.fn(),
      onActivity: vi.fn(),
      execute: async (_name, args) => ({
        path: args.path,
        content: 'const source = "test";\n'.repeat(1500),
      }),
    });
    expect(result).toBe("Inspection complete.");
    expect(stream).toHaveBeenCalledTimes(2);
  });
});
