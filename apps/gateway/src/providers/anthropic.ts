import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ModelSpec } from "@router402/shared";
import { env } from "../env.js";
import {
  splitSystem,
  type CompletionChunk,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
} from "./types.js";

function client(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ProviderUnavailableError(
      "Anthropic models are unavailable: ANTHROPIC_API_KEY is not set",
    );
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export class ProviderUnavailableError extends Error {}

function toParams(request: CompletionRequest) {
  const { system, turns } = splitSystem(request.messages);
  return {
    model: request.model.upstreamId,
    // Anthropic counts thinking against `max_tokens`, so the paid-for total is
    // a true ceiling here and needs no separate thinking budget.
    max_tokens: request.maxOutputTokens,
    ...(system ? { system } : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    messages: turns satisfies Anthropic.MessageParam[],
  };
}

function finishReason(
  stopReason: Anthropic.Message["stop_reason"],
): CompletionResult["finishReason"] {
  switch (stopReason) {
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    default:
      return "stop";
  }
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export const anthropicProvider: Provider = {
  id: "anthropic",

  async countInputTokens(model: ModelSpec, messages: ChatMessage[]) {
    const { system, turns } = splitSystem(messages);
    const response = await client().messages.countTokens({
      model: model.upstreamId,
      ...(system ? { system } : {}),
      messages: turns,
    });
    return response.input_tokens;
  },

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await client().messages.create(toParams(request));
    return {
      text: textOf(response.content),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      finishReason: finishReason(response.stop_reason),
    };
  },

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
    const stream = client().messages.stream(toParams(request));

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    yield {
      type: "done",
      result: {
        text: textOf(message.content),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        finishReason: finishReason(message.stop_reason),
      },
    };
  },
};
