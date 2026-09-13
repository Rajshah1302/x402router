import type { ProviderId } from "@router402/shared";
import { env } from "../env.js";
import { anthropicProvider } from "./anthropic.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { googleProvider } from "./google.js";
import type { Provider } from "./types.js";

/**
 * Use the real provider when its API key is configured, and fall back to
 * DeepSeek otherwise.
 *
 * The catalogue still advertises Claude and Gemini — model id, display name,
 * provider label and pricing are all untouched. Only the upstream that
 * actually produces the tokens is swapped, so the demo runs without Anthropic
 * or Google credentials.
 */
const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: env.ANTHROPIC_API_KEY
    ? anthropicProvider
    : createDeepSeekProvider("anthropic"),
  google: env.GEMINI_API_KEY
    ? googleProvider
    : createDeepSeekProvider("google"),
};

export function providerFor(id: ProviderId): Provider {
  return PROVIDERS[id];
}

export { ProviderUnavailableError } from "./errors.js";
export type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
} from "./types.js";
