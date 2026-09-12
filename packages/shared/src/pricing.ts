import type { ModelSpec } from "./models.js";

/** USDC on Hedera (HTS) carries 6 decimals. */
export const USDC_DECIMALS = 6;
const ATOMIC_PER_USDC = 10 ** USDC_DECIMALS;

/**
 * Gateway margin over upstream provider cost, as a fraction. 0.1 = 10%.
 * This is Router402's revenue; it is applied to the quote, not to the
 * recorded provider cost, so analytics can show both.
 */
export const DEFAULT_MARGIN = 0.1;

/**
 * Smallest amount Router402 will quote. One atomic unit of USDC is $0.000001,
 * which is below what any settlement is worth doing, so trivial requests are
 * floored here rather than rounded to zero.
 */
export const MIN_CHARGE_ATOMIC = 100n; // $0.0001

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Provider cost of a completed request, in USD. */
export function providerCostUsd(model: ModelSpec, usage: TokenUsage): number {
  return (
    (usage.inputTokens * model.inputPricePerMTok +
      usage.outputTokens * model.outputPricePerMTok) /
    1_000_000
  );
}

/** Convert a USD amount to USDC atomic units, rounding up so we never under-quote. */
export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.ceil(usd * ATOMIC_PER_USDC));
}

export function atomicToUsd(atomic: bigint): number {
  return Number(atomic) / ATOMIC_PER_USDC;
}

/**
 * Thinking tokens a reasoning model may spend, as a multiple of the visible
 * output the caller asked for. Reasoning models bill thinking at the output
 * rate, so this has to be bought up front along with the answer.
 */
export const REASONING_ALLOWANCE = 1;

export interface Quote {
  /** Tokens counted in the prompt. */
  inputTokens: number;
  /**
   * Total output tokens the caller is buying — visible answer plus any
   * thinking allowance. This is the figure that is priced and capped.
   */
  maxOutputTokens: number;
  /** Of that total, what the caller may receive as answer text. */
  visibleOutputTokens: number;
  /** Of that total, what the model may spend reasoning before answering. */
  thinkingTokens: number;
  /** Upstream cost at the authorised ceiling, in USD. */
  providerCostUsd: number;
  /** What the caller pays, in USDC atomic units. */
  amountAtomic: bigint;
  /** The same figure in USD, for display. */
  amountUsd: number;
  marginFraction: number;
}

/**
 * Price a request *before* it runs.
 *
 * The `exact` x402 scheme settles the quoted amount in full — there is no
 * partial settlement on Hedera today — so the quote has to be an amount we are
 * willing to charge unconditionally. Router402 therefore sells an *authorised
 * budget*: the counted prompt plus a bounded completion, with the upstream
 * request capped at exactly that ceiling. A caller is never charged for tokens
 * it did not authorise, and never billed a surprise overage.
 *
 * `requestedOutputTokens` is the *visible* answer the caller asked for, which
 * is what `max_tokens` means everywhere else. Reasoning models bill their
 * thinking at the output rate on top of that, so a thinking allowance is added
 * here, priced, and passed to the provider as an explicit cap — otherwise a
 * model can spend the whole budget reasoning and return a truncated answer,
 * which is exactly what Gemini does when only `maxOutputTokens` is set.
 *
 * Unused output budget is not refunded. Callers control their spend by setting
 * `max_tokens`; analytics reports authorised against actual so the gap is
 * visible. Swap this for the `upto` scheme once Hedera supports it and the
 * settlement can be trimmed to real usage.
 */
export function quoteRequest(
  model: ModelSpec,
  inputTokens: number,
  requestedOutputTokens: number,
  marginFraction = DEFAULT_MARGIN,
): Quote {
  const thinkingShare = model.reasoning ? REASONING_ALLOWANCE : 0;

  // Fit visible + thinking inside what the model will actually emit.
  const visibleOutputTokens = Math.max(
    1,
    Math.min(
      requestedOutputTokens,
      Math.floor(model.maxOutputTokens / (1 + thinkingShare)),
    ),
  );
  const thinkingTokens = Math.floor(visibleOutputTokens * thinkingShare);
  const maxOutputTokens = visibleOutputTokens + thinkingTokens;

  const cost = providerCostUsd(model, {
    inputTokens,
    outputTokens: maxOutputTokens,
  });
  const withMargin = cost * (1 + marginFraction);
  const amountAtomic = max(usdToAtomic(withMargin), MIN_CHARGE_ATOMIC);

  return {
    inputTokens,
    maxOutputTokens,
    visibleOutputTokens,
    thinkingTokens,
    providerCostUsd: cost,
    amountAtomic,
    amountUsd: atomicToUsd(amountAtomic),
    marginFraction,
  };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
