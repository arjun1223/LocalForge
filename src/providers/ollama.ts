import { Channel } from "@tauri-apps/api/core";
import { cancel, id, native } from "../native";
import {
  unknownCapabilities,
  type Capabilities,
  type Model,
  type ToolCall,
} from "../types";
import type { ChatRequest, ChatResponse, LocalModelProvider } from "./provider";

export function capabilitiesFromInfo(
  info: Record<string, unknown>,
): Capabilities {
  const caps = unknownCapabilities();
  const names = info.capabilities;
  if (Array.isArray(names)) {
    caps.chat = names.includes("completion");
    caps.tools = names.includes("tools");
    caps.vision = names.includes("vision");
    caps.reasoning = names.includes("thinking");
  }
  // Ollama has no reliable per-model declaration for constrained JSON output.
  const metadata = info.model_info as Record<string, unknown> | undefined;
  const length = Object.entries(metadata ?? {}).find(
    ([k, v]) => k.endsWith(".context_length") && typeof v === "number",
  )?.[1];
  if (typeof length === "number") caps.contextLength = length;
  return caps;
}
export class NdjsonParser {
  private buffer = "";
  constructor(
    private readonly accept: (value: Record<string, unknown>) => void,
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 4 * 1024 * 1024)
      throw new Error("Ollama stream frame exceeds 4 MiB");
    let i: number;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      this.line(this.buffer.slice(0, i));
      this.buffer = this.buffer.slice(i + 1);
    }
  }
  finish() {
    this.line(this.buffer);
    this.buffer = "";
  }
  private line(s: string) {
    if (s.trim()) this.accept(JSON.parse(s) as Record<string, unknown>);
  }
}
export class OllamaProvider implements LocalModelProvider {
  readonly id = "ollama";
  private readonly cache = new Map<string, Model>();
  private active = new Set<string>();
  constructor(readonly baseUrl: string) {}
  private async request<T>(
    route: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const operationId = id();
    const stop = () => {
      void cancel(operationId).catch(() => {});
    };
    signal?.addEventListener("abort", stop, { once: true });
    this.active.add(operationId);
    try {
      return await native<T>("ollama_request", {
        baseUrl: this.baseUrl,
        route,
        body: body ?? null,
        operationId,
        onChunk: new Channel<number[]>(),
      });
    } finally {
      this.active.delete(operationId);
      signal?.removeEventListener("abort", stop);
    }
  }
  async listModels(signal?: AbortSignal) {
    const response = await this.request<{
      models: {
        name: string;
        size?: number;
        details?: { parameter_size?: string; quantization_level?: string };
        capabilities?: string[];
      }[];
    }>("tags", undefined, signal);
    this.cache.clear();
    return response.models.map((m) => ({
      id: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      capabilities: capabilitiesFromInfo(
        m as unknown as Record<string, unknown>,
      ),
    }));
  }
  async getModelInfo(model: string, signal?: AbortSignal): Promise<Model> {
    if (this.cache.has(model)) return this.cache.get(model)!;
    const info = await this.request<Record<string, unknown>>(
      "show",
      { model },
      signal,
    );
    const details = info.details as
      { parameter_size?: string; quantization_level?: string } | undefined;
    const result = {
      id: model,
      capabilities: capabilitiesFromInfo(info),
      parameterSize: details?.parameter_size,
      quantization: details?.quantization_level,
    };
    this.cache.set(model, result);
    return result;
  }
  async getCapabilities(model: string) {
    return (await this.getModelInfo(model)).capabilities;
  }
  async supportsTools(model: string) {
    return (await this.getCapabilities(model)).tools;
  }
  async supportsVision(model: string) {
    return (await this.getCapabilities(model)).vision;
  }
  private body(r: ChatRequest, stream: boolean) {
    return {
      model: r.model,
      messages: r.messages,
      tools: r.tools,
      stream,
      options: {
        temperature: r.options.temperature,
        num_ctx: r.options.contextLength,
        num_predict: r.options.maxTokens,
      },
    };
  }
  async chat(r: ChatRequest): Promise<ChatResponse> {
    const v = await this.request<{
      message: { content?: string; thinking?: string; tool_calls?: ToolCall[] };
    }>("chat", this.body(r, false), r.signal);
    return {
      content: v.message.content ?? "",
      thinking: v.message.thinking,
      toolCalls: v.message.tool_calls ?? [],
    };
  }
  async streamChat(
    r: ChatRequest,
    onText: (s: string) => void,
  ): Promise<ChatResponse> {
    r.signal.throwIfAborted();
    const operationId = id();
    this.active.add(operationId);
    let content = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];
    let streamError: Error | undefined;
    const parser = new NdjsonParser((chunk) => {
      if (chunk.error) throw new Error(String(chunk.error));
      const m = chunk.message as
        | { content?: string; thinking?: string; tool_calls?: ToolCall[] }
        | undefined;
      if (m?.content) {
        content += m.content;
        onText(m.content);
      }
      if (m?.thinking) thinking += m.thinking;
      if (m?.tool_calls) toolCalls.push(...m.tool_calls);
    });
    const channel = new Channel<number[]>();
    const decoder = new TextDecoder();
    channel.onmessage = (data) => {
      try {
        parser.push(decoder.decode(new Uint8Array(data), { stream: true }));
      } catch (e) {
        streamError = e instanceof Error ? e : new Error(String(e));
        void cancel(operationId).catch(() => {});
      }
    };
    const stop = () => {
      void cancel(operationId).catch(() => {});
    };
    r.signal.addEventListener("abort", stop, { once: true });
    try {
      await native("ollama_request", {
        baseUrl: this.baseUrl,
        route: "chat",
        body: this.body(r, true),
        operationId,
        onChunk: channel,
      });
      if (streamError) throw streamError;
      parser.push(decoder.decode());
      parser.finish();
      r.signal.throwIfAborted();
      return { content, thinking: thinking || undefined, toolCalls };
    } finally {
      this.active.delete(operationId);
      r.signal.removeEventListener("abort", stop);
    }
  }
  cancelGeneration() {
    for (const operationId of this.active)
      void cancel(operationId).catch(() => {});
  }
}
