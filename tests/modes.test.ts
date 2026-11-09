import { describe, expect, it, vi } from "vitest";
import { chatMessages } from "../src/context/chat";
import { runAgent } from "../src/agent/orchestrator";
import type {
  LocalModelProvider,
  ChatRequest,
} from "../src/providers/provider";

describe("workspace access by mode", () => {
  it("makes selected-workspace access unavailable in Chat and directs project work to Code Agent", () => {
    const task = {
      role: "user" as const,
      content: "Inspect my codebase and fix bugs",
    };
    const result = chatMessages([task], {}, "/selected/project");
    expect(result[0].content).toContain("Chat has no filesystem");
    expect(result[0].content).toContain("/selected/project");
    expect(result[0].content).toContain("Use Code Agent");
    expect(result[0].content).toContain(
      "Do not ask them to paste the repository",
    );
    expect(result.at(-1)).toBe(task);
  });
  it("keeps mode instructions with model-specific system preferences and supports explicit attachments", () => {
    const input = {
      role: "user" as const,
      content: "Discuss this attached source: const x = 1",
    };
    const result = chatMessages([input], {
      systemPrompt: "Keep answers concise",
    });
    expect(result[0].content).toContain("Chat mode");
    expect(result[0].content).toContain("explicitly attached");
    expect(result[0].content).toContain("Keep answers concise");
    expect(result.at(-1)?.content).toContain("const x = 1");
  });
  it("supplies real registered tools in Agent mode despite earlier Chat-mode access disclaimers", async () => {
    const requests: ChatRequest[] = [];
    const execute = vi.fn(async () => ({
      path: "package.json",
      content: '{"name":"fixture"}',
    }));
    const provider = {
      streamChat: vi.fn(async (request: ChatRequest) => {
        requests.push(request);
        return requests.length === 1
          ? {
              content: "Inspecting package.json",
              toolCalls: [
                {
                  function: {
                    name: "read_file",
                    arguments: { path: "package.json" },
                  },
                },
              ],
            }
          : { content: "The project is named fixture.", toolCalls: [] };
      }),
    } as unknown as LocalModelProvider;
    const answer = await runAgent({
      provider,
      model: "any-compatible-model",
      options: {},
      messages: [
        {
          role: "assistant",
          content: "I do not have access to your codebase. Paste your code.",
        },
        {
          role: "user",
          content: "Inspect package.json in the selected project",
        },
      ],
      workspace: "/selected/project",
      nativeTools: true,
      maxIterations: 3,
      signal: new AbortController().signal,
      onText: vi.fn(),
      onResetText: vi.fn(),
      onActivity: vi.fn(),
      execute,
    });
    expect(answer).toContain("fixture");
    expect(
      requests[0].tools?.some((tool) => tool.function.name === "read_file"),
    ).toBe(true);
    expect(requests[0].messages[0].content).toContain("Code Agent mode");
    expect(requests[0].messages[0].content).toContain(
      "Earlier assistant messages",
    );
    expect(execute).toHaveBeenCalledWith("read_file", { path: "package.json" });
    expect(
      requests[1].messages.some(
        (message) =>
          message.role === "tool" && message.content.includes("fixture"),
      ),
    ).toBe(true);
  });
});
