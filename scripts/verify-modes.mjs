// Actual local-model routing check. Agent execution is restricted to one real source read.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      'export { chatMessages } from "./src/context/chat"; export { runAgent } from "./src/agent/orchestrator";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { chatMessages, runAgent } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const base = process.env.OLLAMA_URL || "http://localhost:11434";
const models = await (await fetch(`${base}/api/tags`)).json();
const model = process.env.TEST_MODEL || models.models?.[0]?.name;
if (!model) throw new Error("No local model installed");
const signal = AbortSignal.timeout(240000);
async function chat(messages, tools) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: false,
      options: { temperature: 0, num_ctx: 9216, num_predict: 4096 },
    }),
    signal,
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).message;
}
const history = [
  {
    role: "user",
    content: "Take a look at this project, fix bugs, and improve the UI.",
  },
  {
    role: "assistant",
    content: "I do not have access to your codebase. Please paste it.",
  },
  { role: "user", content: "Try again." },
];
const answer = await chat(chatMessages(history, { contextLength: 9216 }, root));
if (!/Code Agent/i.test(answer.content || ""))
  throw new Error(`Chat did not explain the required mode: ${answer.content}`);
console.log("PASS: Chat directs the project request to Code Agent.");
console.log(answer.content);
let read = false;
const final = await runAgent({
  provider: {
    async streamChat(request, onText) {
      const message = await chat(request.messages, request.tools);
      onText(message.content || "");
      return {
        content: message.content || "",
        thinking: message.thinking,
        toolCalls: message.tool_calls || [],
      };
    },
  },
  model,
  options: { contextLength: 9216, maxTokens: 4096 },
  messages: [
    ...history.slice(0, 2),
    {
      role: "user",
      content:
        "You are now in Code Agent mode. Read package.json using read_file and report the project name and version. Do not edit anything, run commands, inspect Git, or read other files.",
    },
  ],
  workspace: root,
  nativeTools: true,
  maxIterations: 5,
  signal,
  onText() {},
  onResetText() {},
  onActivity() {},
  async execute(name, args) {
    if (name !== "read_file" || args.path !== "package.json")
      return {
        error: "This read-only verification allows only reading package.json.",
      };
    read = true;
    return {
      path: "package.json",
      content: await readFile(
        new URL("../package.json", import.meta.url),
        "utf8",
      ),
    };
  },
});
if (!read || !/localforge/i.test(final))
  throw new Error(`Agent did not read the actual package metadata: ${final}`);
console.log(
  "PASS: Agent used read_file despite the earlier Chat-mode access disclaimer.",
);
console.log(final);
