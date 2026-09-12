/**
 * Router402 model catalogue.
 *
 * Prices are USD per 1,000,000 tokens, as published by each provider. They are
 * the *cost* side of the ledger; what a caller pays is derived in `pricing.ts`,
 * which applies the gateway margin on top.
 *
 * Sources (checked 2026-09-13):
 *   Anthropic — https://docs.claude.com/en/docs/about-claude/pricing
 *   Google    — https://ai.google.dev/gemini-api/docs/pricing
 */

export type ProviderId = "anthropic" | "google";

export interface ModelSpec {
  /** OpenRouter-style id the caller sends as `model`. */
  id: string;
  /** The id understood by the upstream provider API. */
  upstreamId: string;
  provider: ProviderId;
  displayName: string;
  /** Largest prompt the model accepts, in tokens. */
  contextWindow: number;
  /** Largest completion the model will produce, in tokens. */
  maxOutputTokens: number;
  /** USD per 1M input tokens. */
  inputPricePerMTok: number;
  /** USD per 1M output tokens. */
  outputPricePerMTok: number;
  /** Model reasons before answering; completions skew longer. */
  reasoning: boolean;
}

export const MODELS: readonly ModelSpec[] = [
  {
    id: "anthropic/claude-opus-5",
    upstreamId: "claude-opus-5",
    provider: "anthropic",
    displayName: "Claude Opus 5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMTok: 5.0,
    outputPricePerMTok: 25.0,
    reasoning: true,
  },
  {
    id: "anthropic/claude-sonnet-5",
    upstreamId: "claude-sonnet-5",
    provider: "anthropic",
    displayName: "Claude Sonnet 5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMTok: 2.0,
    outputPricePerMTok: 10.0,
    reasoning: true,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    upstreamId: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputPricePerMTok: 1.0,
    outputPricePerMTok: 5.0,
    reasoning: false,
  },
  {
    id: "google/gemini-3.1-pro",
    upstreamId: "gemini-3.1-pro-preview",
    provider: "google",
    displayName: "Gemini 3.1 Pro",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputPricePerMTok: 2.0,
    outputPricePerMTok: 12.0,
    reasoning: true,
  },
  {
    id: "google/gemini-3.8-flash",
    upstreamId: "gemini-3.8-flash",
    provider: "google",
    displayName: "Gemini 3.8 Flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputPricePerMTok: 0.75,
    outputPricePerMTok: 3.75,
    reasoning: true,
  },
  {
    id: "google/gemini-3.5-flash-lite",
    upstreamId: "gemini-3.5-flash-lite",
    provider: "google",
    displayName: "Gemini 3.5 Flash-Lite",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    inputPricePerMTok: 0.3,
    outputPricePerMTok: 2.5,
    reasoning: false,
  },
] as const;

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

/** Bare ids (`claude-opus-5`) resolve to their namespaced entry, OpenRouter-style. */
const BY_BARE_ID = new Map(MODELS.map((m) => [m.upstreamId, m]));

export function findModel(id: string): ModelSpec | undefined {
  return BY_ID.get(id) ?? BY_BARE_ID.get(id);
}

export const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5";
