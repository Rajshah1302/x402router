import { GoogleGenAI, type Content, type GenerateContentResponse } from "@google/genai";
import type { ChatMessage, ModelSpec } from "@router402/shared";
import { env } from "../env.js";
import { ProviderUnavailableError } from "./anthropic.js";
import {
  splitSystem,
  type CompletionChunk,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
} from "./types.js";

function client(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new ProviderUnavailableError(
      "Gemini models are unavailable: GEMINI_API_KEY is not set",
    );
  }
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
}

/** Gemini calls the assistant turn "model". */
function toContents(messages: ChatMessage[]): Content[] {
  const { turns } = splitSystem(messages);
  return turns.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));
}

function toConfig(request: CompletionRequest) {
  const { system } = splitSystem(request.messages);
  return {
    maxOutputTokens: request.maxOutputTokens,
    ...(system ? { systemInstruction: system } : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
  };
}

function usageOf(response: GenerateContentResponse) {
  const usage = response.usageMetadata;
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    // Thinking tokens are billed at the output rate, so they count here.
    outputTokens:
      (usage?.candidatesTokenCount ?? 0) +
      (usage?.thoughtsTokenCount ?? 0),
  };
}

function finishReason(
  response: GenerateContentResponse,
): CompletionResult["finishReason"] {
  const reason = response.candidates?.[0]?.finishReason;
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "content_filter";
    default:
      return "stop";
  }
}

export const googleProvider: Provider = {
  id: "google",

  async countInputTokens(model: ModelSpec, messages: ChatMessage[]) {
    const response = await client().models.countTokens({
      model: model.upstreamId,
      contents: toContents(messages),
    });
    return response.totalTokens ?? 0;
  },

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await client().models.generateContent({
      model: request.model.upstreamId,
      contents: toContents(request.messages),
      config: toConfig(request),
    });

    return {
      text: response.text ?? "",
      usage: usageOf(response),
      finishReason: finishReason(response),
    };
  },

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
    const stream = await client().models.generateContentStream({
      model: request.model.upstreamId,
      contents: toContents(request.messages),
      config: toConfig(request),
    });

    let text = "";
    // Gemini reports cumulative usage on every chunk; the last one wins.
    let last: GenerateContentResponse | undefined;

    for await (const chunk of stream) {
      last = chunk;
      const delta = chunk.text;
      if (delta) {
        text += delta;
        yield { type: "delta", text: delta };
      }
    }

    yield {
      type: "done",
      result: {
        text,
        usage: last ? usageOf(last) : { inputTokens: 0, outputTokens: 0 },
        finishReason: last ? finishReason(last) : "stop",
      },
    };
  },
};
