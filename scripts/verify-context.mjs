// Real-model, read-only regression check for batched source reads at the default context size.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const result = await build({
  stdin: {
    contents:
      'export { runAgent } from "./src/agent/orchestrator"; export { contextBudget, contextSize } from "./src/context/context";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { runAgent, contextBudget, contextSize } = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
const base = process.env.OLLAMA_URL || "http://localhost:11434";
const tags = await (await fetch(`${base}/api/tags`)).json();
const model = process.env.TEST_MODEL || tags.models?.[0]?.name;
if (!model) throw new Error("No installed model");
const paths = [
  "src/components/Sidebar.tsx",
  "src/components/Topbar.tsx",
  "src/components/MessageList.tsx",
];
const seen = new Set();
let compacted = false;
let turn = 0;
let largestBatch = 0;
const signal = AbortSignal.timeout(240000);
const provider = {
  async streamChat(request, onText) {
    turn++;
    const size = contextSize(request.messages, request.tools);
    if (size > contextBudget(8192, 4096))
      throw new Error("Packed request exceeds budget");
    compacted ||= request.messages.some(
      (message) =>
        message.role === "tool" &&
        message.content.includes("context_truncated"),
    );
    console.log(
      `Turn ${turn}: ${size}/${contextBudget(8192, 4096)} estimated prompt characters`,
    );
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: request.messages,
        tools: request.tools,
        stream: false,
        options: { temperature: 0, num_ctx: 8192, num_predict: 4096 },
      }),
      signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const value = await response.json();
    const message = value.message;
    largestBatch = Math.max(largestBatch, message.tool_calls?.length ?? 0);
    onText(message.content || "");
    return {
      content: message.content || "",
      thinking: message.thinking,
      toolCalls: message.tool_calls || [],
    };
  },
};
const final = await runAgent({
  provider,
  model,
  options: { contextLength: 8192, maxTokens: 4096 },
  messages: [
    {
      role: "user",
      content: `Read these three source files using three read_file calls together in your first response: ${paths.join(", ")}. Then reply with exactly CONTEXT_OK, without analyzing the files or requesting more source. This is a read-only context regression test. Do not edit files, run commands, inspect Git, or inspect other files.`,
    },
  ],
  workspace: fileURLToPath(new URL("..", import.meta.url)),
  nativeTools: true,
  maxIterations: 5,
  signal,
  onText() {},
  onResetText() {},
  onActivity(activity) {
    if (activity.status === "error")
      console.log("Activity error:", activity.label);
  },
  async execute(name, args) {
    if (
      !["read_file", "read_file_range"].includes(name) ||
      !paths.includes(args.path)
    )
      return {
        error:
          "This regression test permits only the three requested source reads.",
      };
    seen.add(args.path);
    const content = await readFile(
      new URL("../" + args.path, import.meta.url),
      "utf8",
    );
    if (name === "read_file_range") {
      if (
        args.start < 1 ||
        args.end < args.start ||
        args.end - args.start > 500
      )
        return { error: "Use a 1-based range of at most 501 lines." };
      return {
        path: args.path,
        content: content
          .split("\n")
          .slice(args.start - 1, args.end)
          .map((line, index) => `${args.start + index}: ${line}`)
          .join("\n"),
      };
    }
    return { path: args.path, content };
  },
});
if (
  seen.size !== paths.length ||
  largestBatch < 3 ||
  !compacted ||
  !final.includes("CONTEXT_OK")
)
  throw new Error(
    `Regression scenario incomplete: read=${seen.size}, batch=${largestBatch}, compacted=${compacted}`,
  );
console.log(
  `PASS: ${model} read all three real source files in one batch, continued with compacted context, and answered at 8192 context tokens.`,
);
console.log(final);
