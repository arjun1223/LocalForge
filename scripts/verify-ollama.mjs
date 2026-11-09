// Real loopback API smoke test. Model names are always discovered at runtime.
const endpoint = process.env.OLLAMA_URL || "http://localhost:11434";
async function api(route, body) {
  const response = await fetch(`${endpoint}/api/${route}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response;
}
const tags = await (await api("tags")).json();
if (!tags.models?.length) throw new Error("No installed models detected");
const model = process.env.TEST_MODEL || tags.models[0].name;
console.log(`Discovered ${tags.models.length} model(s). Testing ${model}`);
const metadata = await (await api("show", { model })).json();
console.log("Capabilities:", metadata.capabilities ?? "Unknown");
const chat = await (
  await api("chat", {
    model,
    stream: true,
    messages: [
      {
        role: "user",
        content: "Reply with exactly LOCAL_OK and nothing else.",
      },
    ],
    options: { num_ctx: 4096, num_predict: 2048, temperature: 0 },
  })
).text();
const frames = chat.trim().split("\n").map(JSON.parse);
const text = frames.map((f) => f.message?.content ?? "").join("");
if (!text.includes("LOCAL_OK"))
  throw new Error(`Unexpected chat response: ${text}`);
console.log("Streaming chat: PASS", text);
if (metadata.capabilities?.includes("tools")) {
  const result = await (
    await api("chat", {
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content:
            'Call list_directory with path "." now. Do not answer in prose.',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "list_directory",
            description: "List project files",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        },
      ],
      options: { num_ctx: 4096, num_predict: 2048, temperature: 0 },
    })
  ).json();
  if (
    !result.message?.tool_calls?.some(
      (t) =>
        t.function?.name === "list_directory" &&
        t.function.arguments.path === ".",
    )
  )
    throw new Error(
      `Model did not return the requested tool call: ${JSON.stringify(result.message)}`,
    );
  console.log("Native tool calling: PASS");
}
