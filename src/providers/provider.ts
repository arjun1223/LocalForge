import type {
  Capabilities,
  Model,
  ModelMessage,
  ModelSettings,
  ToolCall,
} from "../types";
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
export interface ChatRequest {
  model: string;
  messages: ModelMessage[];
  options: ModelSettings;
  tools?: ToolDefinition[];
  signal: AbortSignal;
}
export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  thinking?: string;
}
export interface LocalModelProvider {
  readonly id: string;
  listModels(signal?: AbortSignal): Promise<Model[]>;
  getModelInfo(model: string, signal?: AbortSignal): Promise<Model>;
  getCapabilities(model: string): Promise<Capabilities>;
  supportsTools(model: string): Promise<boolean | "unknown">;
  supportsVision(model: string): Promise<boolean | "unknown">;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(
    request: ChatRequest,
    onText: (text: string) => void,
  ): Promise<ChatResponse>;
  cancelGeneration(): void;
}
