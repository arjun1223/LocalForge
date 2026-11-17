import { expect, it } from "vitest";
import {
  conversationMarkdown,
  filterConversations,
} from "../src/history/conversations";
import type { Conversation } from "../src/types";

const chat: Conversation = {
  id: "1",
  title: "Build notes",
  model: "local-model",
  provider: "ollama",
  mode: "agent",
  createdAt: 0,
  updatedAt: 1,
  workspace: "/private/project",
  activity: [],
  changes: [],
  messages: [
    {
      id: "2",
      role: "user",
      content: "Fix the parser",
      createdAt: 0,
      attachments: [
        {
          name: "parser.ts",
          path: "/private/parser.ts",
          content: "private attached text",
        },
      ],
    },
    {
      id: "3",
      role: "assistant",
      content: "```ts\nexport {};\n```",
      outcome: "stopped",
      createdAt: 1,
    },
  ],
};

it("searches saved messages, titles, and attachment names across terms", () => {
  expect(filterConversations([chat], " BUILD parser.ts ")).toEqual([chat]);
  expect(filterConversations([chat], "export")).toEqual([chat]);
  expect(filterConversations([chat], "build missing")).toEqual([]);
  expect(filterConversations([chat], "private attached text")).toEqual([]);
  expect(filterConversations([chat], "   ")).toEqual([chat]);
});

it("copies the transcript without workspace paths or raw attachment contents", () => {
  const output = conversationMarkdown(chat);
  expect(output).toContain(
    "## You\n\nAttachments: parser.ts.\n\nFix the parser",
  );
  expect(output).toContain(
    "## LocalForge\n\nStatus: stopped.\n\n```ts\nexport {};\n```",
  );
  expect(output).not.toContain("/private/");
  expect(output).not.toContain("private attached text");
});
