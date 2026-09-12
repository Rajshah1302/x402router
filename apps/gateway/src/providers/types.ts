import type { ChatMessage, ModelSpec } from "@router402/shared";

export interface CompletionRequest {
  model: ModelSpec;
  messages: ChatMessage[];
  /** Hard ceiling on output tokens — the amount the caller paid for. */
  maxOutputTokens: number;
  temperature?: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
  finishReason: "stop" | "length" | "content_filter" | "error";
}

/** Streaming yields text deltas, then exactly one final chunk carrying usage. */
export type CompletionChunk =
  | { type: "delta"; text: string }
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
      systemParts.push(message.content);
    } else {
      turns.push({ role: message.role, content: message.content });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    turns,
  };
}
