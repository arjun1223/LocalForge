// Make an actual large edit in a disposable directory, then verify a real local
// model can continue from its compacted, truthful completion record.
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const bundle = await build({
  stdin: {
    contents:
      'export { fitContext, contextBudget, contextSize } from "./src/context/context"; export { tools } from "./src/tools/registry";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { fitContext, contextBudget, contextSize, tools } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const base = process.env.OLLAMA_URL || "http://localhost:11434";
const tags = await (await fetch(`${base}/api/tags`)).json();
const model = process.env.TEST_MODEL || tags.models?.[0]?.name;
if (!model) throw new Error("No installed local model");
const root = await mkdtemp(join(tmpdir(), "localforge-completed-edit-"));
try {
  const source =
    "// actual safely generated test source\n".repeat(3000) +
    "export const complete = true;\n";
  await writeFile(join(root, "source.mjs"), source);
  execFileSync(process.execPath, ["--check", join(root, "source.mjs")]);
  const messages = [
    {
      role: "system",
      content:
        "This is a continuation test. Use the application record as evidence of completed actions. Do not call tools or repeat any action. Reply concisely.",
    },
    {
      role: "user",
      content:
        "Report the filename and whether the recorded large edit was applied. Include exactly EDIT_CONTEXT_OK at the end.",
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "write_file",
            arguments: { path: "source.mjs", content: source },
          },
        },
      ],
    },
    {
      role: "tool",
      tool_name: "write_file",
      content: JSON.stringify({
        path: "source.mjs",
        applied: true,
        after: source,
      }),
    },
  ];
  const snapshot = structuredClone(messages);
  const fitted = fitContext(messages, 8192, 4096, { tools, task: messages[1] });
  if (
    contextSize(fitted, tools) > contextBudget(8192, 4096) ||
    !fitted.at(-1).content.includes('"applied":true')
  )
    throw new Error("Completed edit did not fit");
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: fitted,
      stream: false,
      options: { num_ctx: 8192, num_predict: 4096, temperature: 0 },
    }),
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) throw new Error(await response.text());
  const answer = (await response.json()).message?.content || "";
  if (
    !answer.includes("source.mjs") ||
    !answer.includes("EDIT_CONTEXT_OK") ||
    !/applied|saved|written|completed/i.test(answer)
  )
    throw new Error(`Unexpected continuation: ${answer}`);
  if (
    JSON.stringify(messages) !== JSON.stringify(snapshot) ||
    (await readFile(join(root, "source.mjs"), "utf8")) !== source
  )
    throw new Error("Source/history changed during packing");
  console.log(
    `PASS: ${model} continued at 8192 context after a real ${source.length}-character write and syntax check. Original source and history remained intact.`,
  );
  console.log(answer);
} finally {
  await rm(root, { recursive: true, force: true });
}
