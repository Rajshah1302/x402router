import type {
  ChatMessage,
  ModelSpec,
  ToolCall,
  ToolCallDelta,
  ToolDefinition,
} from "@router402/shared";

export interface CompletionRequest {
  model: ModelSpec;
  messages: ChatMessage[];
  /**
   * Hard ceiling on total output tokens — visible answer plus thinking — and
   * exactly the amount the caller paid for.
   */
  maxOutputTokens: number;
  /** Share of that ceiling the model may spend reasoning. */
  thinkingTokens: number;
  temperature?: number;
  /** Tools the model may call. */
  tools?: ToolDefinition[];
  tool_choice?: unknown;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | "error";
  /** Function calls the model asked to make, if any. */
  toolCalls?: ToolCall[];
}

/** Streaming yields deltas (text and/or tool calls), then one final chunk. */
export type CompletionChunk =
  | { type: "delta"; text?: string; toolCalls?: ToolCallDelta[] }
  | { type: "done"; result: CompletionResult };

export interface Provider {
  readonly id: "anthropic" | "google";
  /** Counts prompt tokens so a request can be priced before it runs. */
  countInputTokens(model: ModelSpec, messages: ChatMessage[]): Promise<number>;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
}

/** Split the OpenAI-style message list into a system prompt and a turn list. */
export function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push(message.content);
    } else if (message.role === "user" || message.role === "assistant") {
      // Tool turns are not representable in the Anthropic/Google shapes here;
      // the DeepSeek path passes the raw message list through instead.
      turns.push({ role: message.role, content: message.content ?? "" });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    turns,
  };
}
