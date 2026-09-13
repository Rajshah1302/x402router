import { createHash } from "node:crypto";
import {
  DEFAULT_MODEL_ID,
  findModel,
  quoteRequest,
  type ChatCompletionRequest,
  type ModelSpec,
  type Quote,
} from "@router402/shared";
import { env } from "./env.js";
import { providerFor } from "./providers/index.js";

/** Output budget assumed when a caller does not set `max_tokens`. */
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export class InvalidRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface PricedRequest {
  model: ModelSpec;
  messages: ChatCompletionRequest["messages"];
  temperature: number | undefined;
  stream: boolean;
  tools: ChatCompletionRequest["tools"];
  tool_choice: ChatCompletionRequest["tool_choice"];
  quote: Quote;
}

/**
 * Quotes are computed twice per paid call — once to build the 402 challenge,
 * once when the client returns with payment — and counting prompt tokens costs
 * an upstream round trip each time. Caching on the exact request body makes the
 * second pass free and, more importantly, guarantees both passes quote the same
 * number: a drifting quote would settle an amount the client never authorised.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { expiresAt: number; value: PricedRequest }>();

function cacheKey(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function readCache(key: string): PricedRequest | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache(key: string, value: PricedRequest): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function parseBody(body: unknown): ChatCompletionRequest {
  if (typeof body !== "object" || body === null) {
    throw new InvalidRequestError("Request body must be a JSON object");
  }

  const candidate = body as Partial<ChatCompletionRequest>;

  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new InvalidRequestError("`messages` must be a non-empty array");
  }

  for (const message of candidate.messages) {
    if (
      !message ||
      !["system", "user", "assistant", "tool"].includes(message.role)
    ) {
      throw new InvalidRequestError(
        "Each message needs a role of system, user, assistant or tool",
      );
    }
    if (message.content !== null && typeof message.content !== "string") {
      throw new InvalidRequestError(
        "Each message's `content` must be a string or null",
      );
    }
  }

  if (
    candidate.max_tokens !== undefined &&
    (!Number.isInteger(candidate.max_tokens) || candidate.max_tokens <= 0)
  ) {
    throw new InvalidRequestError("`max_tokens` must be a positive integer");
  }

  return {
    model: candidate.model ?? DEFAULT_MODEL_ID,
    messages: candidate.messages,
    max_tokens: candidate.max_tokens,
    temperature: candidate.temperature,
    stream: candidate.stream ?? false,
    tools: candidate.tools,
    tool_choice: candidate.tool_choice,
  };
}

/** Price a chat completion request without running it. */
export async function priceRequest(body: unknown): Promise<PricedRequest> {
  const key = cacheKey(body);
  const cached = readCache(key);
  if (cached) return cached;

  const request = parseBody(body);

  const model = findModel(request.model);
  if (!model) {
    throw new InvalidRequestError(
      `Unknown model "${request.model}". GET /v1/models lists what this gateway routes.`,
      404,
    );
  }

  const provider = providerFor(model.provider);
  const inputTokens = await provider.countInputTokens(model, request.messages);

  if (inputTokens > model.contextWindow) {
    throw new InvalidRequestError(
      `Prompt is ${inputTokens} tokens; ${model.id} accepts ${model.contextWindow}`,
    );
  }

  const priced: PricedRequest = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    stream: request.stream ?? false,
    tools: request.tools,
    tool_choice: request.tool_choice,
    quote: quoteRequest(
      model,
      inputTokens,
      request.max_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      env.X402_MARGIN,
      env.paymentAsset,
    ),
  };

  writeCache(key, priced);
  return priced;
}
