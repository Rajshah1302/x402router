/**
 * The text records Router402 reads and writes.
 *
 * Well-known keys (`name`, `description`, `url`, `avatar`) keep their standard
 * meaning so a generic ENS browser shows something sensible. Everything
 * Router402-specific is namespaced under `r402:`, and the payment terms under
 * `x402:` because they describe the x402 contract rather than this gateway.
 */
export const AgentRecords = {
  /** Human-readable model name, e.g. "Claude Opus 5". */
  name: "name",
  description: "description",
  /** Base URL of the gateway that serves this agent. */
  url: "url",
  /** Canonical OpenRouter-style id, e.g. "anthropic/claude-opus-5". */
  model: "r402:model",
  /** Upstream id the provider API understands. */
  upstream: "r402:upstream",
  provider: "r402:provider",
  /** USD per 1M input tokens, as a decimal string. */
  priceInput: "r402:price:input",
  /** USD per 1M output tokens, as a decimal string. */
  priceOutput: "r402:price:output",
  contextWindow: "r402:context",
  maxOutputTokens: "r402:max-output",
  /** "true" when the model thinks before answering. */
  reasoning: "r402:reasoning",
  /** Hedera account that receives x402 settlement for this agent. */
  payTo: "x402:pay-to",
  /** e.g. "hedera:testnet". */
  network: "x402:network",
  /** HTS asset id callers pay in. */
  asset: "x402:asset",
} as const;

export const SessionRecords = {
  /** Hedera account that authorized this session. */
  wallet: "r402:wallet",
  /** Hedera account the session key signs payments from. */
  sessionAccount: "r402:session-account",
  /** Total spend ceiling, in the settlement asset's atomic units. */
  capTotal: "r402:cap:total",
  /** Single-request ceiling, in atomic units. */
  capPerRequest: "r402:cap:per-request",
  network: "x402:network",
  asset: "x402:asset",
} as const;

export type AgentRecordKey = (typeof AgentRecords)[keyof typeof AgentRecords];
export type SessionRecordKey =
  (typeof SessionRecords)[keyof typeof SessionRecords];
