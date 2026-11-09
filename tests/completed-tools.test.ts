import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { completedToolSummary } from "../src/context/completedTools";
import { contextBudget, contextSize, fitContext } from "../src/context/context";
import { runAgent } from "../src/agent/orchestrator";
import { tools } from "../src/tools/registry";
import type { ModelMessage } from "../src/types";
import type {
  ChatResponse,
  LocalModelProvider,
} from "../src/providers/provider";

const content =
  "// real source line\n".repeat(4000) + "export const valid = true;\n";
const call = {
  function: { name: "write_file", arguments: { path: "source.mjs", content } },
};
const exchange: ModelMessage[] = [
  { role: "assistant", content: "", tool_calls: [call] },
  {
    role: "tool",
    tool_name: "write_file",
    content: JSON.stringify({
      applied: true,
      path: "source.mjs",
      after: content,
    }),
  },
];
describe("completed tool context", () => {
  it.each([8192, 9216])(
    "fits completed large writes at %i without changing original arguments",
    (context) => {
      const messages: ModelMessage[] = [
        { role: "system", content: "Inspect then edit" },
        { role: "user", content: "Improve the source" },
        ...exchange,
      ];
      const original = structuredClone(messages);
      const fitted = fitContext(messages, context, 4096, {
        tools,
        task: messages[1],
      });
      expect(contextSize(fitted, tools)).toBeLessThanOrEqual(
        contextBudget(context, 4096),
      );
      expect(fitted.at(-1)?.content).toContain('"applied":true');
      expect(fitted.at(-1)?.content).toContain('"path":"source.mjs"');
      expect(fitted.at(-1)?.content).not.toContain("export const valid");
      expect(messages).toEqual(original);
    },
  );
  it("retains rejection and failure outcomes and refuses incomplete or mismatched exchanges", () => {
    for (const result of [
      { rejected: true },
      { error: "File changed since proposal" },
    ]) {
      const summary = completedToolSummary(
        [exchange[0], { ...exchange[1], content: JSON.stringify(result) }],
        0,
      );
      expect(summary?.content).toContain(JSON.stringify(result));
    }
    expect(completedToolSummary([exchange[0]], 0)).toBeUndefined();
    expect(
      completedToolSummary(
        [exchange[0], { ...exchange[1], tool_name: "delete_file" }],
        0,
      ),
    ).toBeUndefined();
    expect(
      completedToolSummary(
        [{ ...exchange[0], tool_calls: [call, call] }, exchange[1]],
        0,
      ),
    ).toBeUndefined();
  });
  it.each([true, false])(
    "writes the full file once and continues through a real syntax check (native=%s)",
    async (nativeTools) => {
      const root = await mkdtemp(join(tmpdir(), "localforge-large-write-"));
      const actions: string[] = [];
      const responses: ChatResponse[] = nativeTools
        ? [
            { content: "", toolCalls: [call] },
            {
              content: "",
              toolCalls: [
                {
                  function: {
                    name: "run_terminal_command",
                    arguments: {
                      program: "node",
                      args: ["--check", "source.mjs"],
                    },
                  },
                },
              ],
            },
            { content: "Verified", toolCalls: [] },
          ]
        : [
            {
              content: JSON.stringify({
                type: "tool_call",
                tool: call.function.name,
                arguments: call.function.arguments,
              }),
              toolCalls: [],
            },
            {
              content: JSON.stringify({
                type: "tool_call",
                tool: "run_terminal_command",
                arguments: { program: "node", args: ["--check", "source.mjs"] },
              }),
              toolCalls: [],
            },
            {
              content: JSON.stringify({ type: "final", content: "Verified" }),
              toolCalls: [],
            },
          ];
      let turns = 0;
      const provider = {
        streamChat: vi.fn(async (request, onText) => {
          expect(
            contextSize(request.messages, request.tools),
          ).toBeLessThanOrEqual(contextBudget(8192, 4096));
          if (turns === 1)
            expect(request.messages.at(-1)?.content).toContain(
              '"applied":true',
            );
          turns++;
          const response = responses.shift()!;
          onText(response.content);
          return response;
        }),
      } as unknown as LocalModelProvider;
      try {
        const final = await runAgent({
          provider,
          model: "arbitrary-model",
          options: { contextLength: 8192, maxTokens: 4096 },
          messages: [
            { role: "user", content: "Write the source and verify it" },
          ],
          workspace: root,
          nativeTools,
          maxIterations: 4,
          signal: new AbortController().signal,
          onText: vi.fn(),
          onResetText: vi.fn(),
          onActivity: vi.fn(),
          execute: async (name, args) => {
            actions.push(name);
            if (name === "write_file") {
              expect(args.content).toBe(content);
              await writeFile(join(root, "source.mjs"), String(args.content));
              return { applied: true, path: "source.mjs", after: content };
            }
            expect(name).toBe("run_terminal_command");
            // Predetermined test command; no model-controlled executable or arguments.
            execFileSync(process.execPath, [
              "--check",
              join(root, "source.mjs"),
            ]);
            return { exit_code: 0 };
          },
        });
        expect(final).toBe("Verified");
        expect(actions).toEqual(["write_file", "run_terminal_command"]);
        expect(await readFile(join(root, "source.mjs"), "utf8")).toBe(content);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
