import type {
  ChatMessage,
  ModelSpec,
  ToolCall,
  ToolCallDelta,
} from "@router402/shared";
import { env } from "../env.js";
import { ProviderUnavailableError } from "./errors.js";
import {
  type CompletionChunk,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
} from "./types.js";

/**
 * DeepSeek upstream, spoken over its OpenAI-compatible HTTP API.
 *
 * Router402's catalogue advertises Claude and Gemini models, but for the demo
 * the actual inference is served here: the display name, provider label and
 * pricing all come from `@router402/shared/models`, while the tokens are
 * produced by DeepSeek. Nothing in the quote, ledger or analytics path knows
 * the difference.
 *
 * Implemented against `fetch` rather than an SDK so the gateway carries no
 * extra dependency for it. Both `deepseek-flash` and `deepseek-v4-pro` are
 * reasoning models: they return `reasoning_content` alongside `content` and
 * bill the thinking tokens as completion tokens, which is exactly how the
 * catalogue's reasoning models are priced.
 *
 * Messages are passed through in OpenAI's shape, so tool calls and tool
 * results work unchanged — that is what lets an agentic harness drive it.
 */

interface DeepSeekMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface DeepSeekChoice {
  message?: { content?: string | null; tool_calls?: ToolCall[] };
  delta?: {
    content?: string | null;
    tool_calls?: ToolCallDelta[];
    reasoning_content?: string | null;
  };
  finish_reason?: string | null;
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
  usage?: DeepSeekUsage;
}

const REQUEST_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 5 * 60_000;

function config(): { apiKey: string; baseUrl: string } {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ProviderUnavailableError(
      "Inference is unavailable: DEEPSEEK_API_KEY is not set",
    );
  }
  return {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL.replace(/\/+$/, ""),
  };
}

function toMessages(messages: ChatMessage[]): DeepSeekMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.name ? { name: message.name } : {}),
  }));
}

function toParams(request: CompletionRequest, stream: boolean) {
  return {
    model: env.DEEPSEEK_MODEL,
    messages: toMessages(request.messages),
    // DeepSeek bills thinking as completion tokens, so the paid-for total is
    // the true ceiling, matching how the catalogue is priced.
    max_tokens: request.maxOutputTokens,
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.tools && request.tools.length > 0
      ? { tools: request.tools }
      : {}),
    ...(request.tool_choice !== undefined
      ? { tool_choice: request.tool_choice }
      : {}),
    ...(stream
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
  };
}

function usageOf(usage: DeepSeekUsage | undefined) {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

function finishReason(
  reason: string | null | undefined,
): CompletionResult["finishReason"] {
  switch (reason) {
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
      return "tool_calls";
    default:
      return "stop";
  }
}

/** An error carrying an HTTP status so the shared handler can classify it. */
function upstreamError(status: number, body: string): Error {
  const error = new Error(
    `DeepSeek returned ${status}: ${body.slice(0, 300)}`,
  ) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * DeepSeek exposes no token-count endpoint, so the prompt is estimated
 * locally. The quote only needs a deterministic figure (it is cached and
 * reused for settlement); the real usage comes back from the completion.
 */
function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += Math.ceil((message.content?.length ?? 0) / 4) + 4;
    if (message.tool_calls) {
      total += Math.ceil(JSON.stringify(message.tool_calls).length / 4);
    }
  }
  return Math.max(1, total);
}

export function createDeepSeekProvider(id: "anthropic" | "google"): Provider {
  return {
    id,

    async countInputTokens(_model: ModelSpec, messages: ChatMessage[]) {
      return estimateTokens(messages);
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const { apiKey, baseUrl } = config();

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(toParams(request, false)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw upstreamError(response.status, await response.text());
      }

      const body = (await response.json()) as DeepSeekResponse;
      const choice = body.choices?.[0];

      return {
        text: choice?.message?.content ?? "",
        usage: usageOf(body.usage),
        finishReason: finishReason(choice?.finish_reason),
        ...(choice?.message?.tool_calls
          ? { toolCalls: choice.message.tool_calls }
          : {}),
      };
    },

    async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
      const { apiKey, baseUrl } = config();

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(toParams(request, true)),
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });

      if (!response.ok || !response.body) {
        throw upstreamError(
          response.status,
          await response.text().catch(() => ""),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let usage: DeepSeekUsage | undefined;
      let reason: string | null | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);

          if (!line.startsWith("data:")) continue;
          const data = line.slice("data:".length).trim();
          if (data === "[DONE]") continue;

          let event: DeepSeekResponse;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = event.choices?.[0];
          const delta = choice?.delta;

          // Only the visible answer is streamed; `reasoning_content` is the
          // model's private thinking and never reaches the caller.
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            text += delta.content;
            yield { type: "delta", text: delta.content };
          }

          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            yield { type: "delta", toolCalls: delta.tool_calls };
          }

          if (choice?.finish_reason) reason = choice.finish_reason;
          if (event.usage) usage = event.usage;
        }
      }

      yield {
        type: "done",
        result: {
          text,
          usage: usageOf(usage),
          finishReason: finishReason(reason),
        },
      };
    },
  };
}
