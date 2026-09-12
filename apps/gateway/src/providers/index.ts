import type { ProviderId } from "@router402/shared";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import type { Provider } from "./types.js";

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  google: googleProvider,
};

export function providerFor(id: ProviderId): Provider {
  return PROVIDERS[id];
}

export { ProviderUnavailableError } from "./anthropic.js";
export type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  Provider,
} from "./types.js";
