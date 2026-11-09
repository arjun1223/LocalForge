// Actual model check for the non-native JSON protocol; no structured-output assumption.
const base = process.env.OLLAMA_URL || "http://localhost:11434";
const tags = await (await fetch(`${base}/api/tags`)).json();
const model = process.env.TEST_MODEL || tags.models?.[0]?.name;
if (!model) throw new Error("No local model");
const messages = [
  {
    role: "system",
    content:
      'Reply only with one JSON object. To use the list_directory tool, return {"type":"tool_call","tool":"list_directory","arguments":{"path":"."}}. To finish, return {"type":"final","content":"your answer"}. No surrounding prose. Do not claim to inspect files before receiving a tool result.',
  },
  {
    role: "user",
    content:
      'Call list_directory with path ".". Do not give a final answer yet.',
  },
];
const response = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    messages,
    stream: false,
    options: { temperature: 0, num_ctx: 4096, num_predict: 2048 },
  }),
  signal: AbortSignal.timeout(180000),
});
if (!response.ok) throw new Error(await response.text());
const body = await response.json();
const content = body.message?.content
  ?.trim()
  .replace(/^```(?:json)?\s*/, "")
  .replace(/\s*```$/, "");
const call = JSON.parse(content);
if (
  call.type !== "tool_call" ||
  call.tool !== "list_directory" ||
  call.arguments?.path !== "."
)
  throw new Error(`Invalid fallback: ${content}`);
console.log(`Structured fallback protocol on ${model}: PASS`);
