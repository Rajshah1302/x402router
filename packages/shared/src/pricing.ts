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

export interface Quote {
  /** Tokens counted in the prompt. */
  inputTokens: number;
  /** Output tokens the caller is buying; also the cap applied upstream. */
  maxOutputTokens: number;
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
 * budget*: the counted prompt plus `maxOutputTokens` of completion, with the
 * upstream request capped at exactly that ceiling. A caller is never charged
 * for tokens it did not authorise, and never billed a surprise overage.
 *
 * Unused output budget is not refunded. Callers control their spend by setting
 * `max_tokens`; analytics reports authorised against actual so the gap is
 * visible. Swap this for the `upto` scheme once Hedera supports it and the
 * settlement can be trimmed to real usage.
 */
export function quoteRequest(
  model: ModelSpec,
  inputTokens: number,
  maxOutputTokens: number,
  marginFraction = DEFAULT_MARGIN,
): Quote {
  const ceiling = Math.min(maxOutputTokens, model.maxOutputTokens);
  const cost = providerCostUsd(model, {
    inputTokens,
    outputTokens: ceiling,
  });
  const withMargin = cost * (1 + marginFraction);
  const amountAtomic = max(usdToAtomic(withMargin), MIN_CHARGE_ATOMIC);

  return {
    inputTokens,
    maxOutputTokens: ceiling,
    providerCostUsd: cost,
    amountAtomic,
    amountUsd: atomicToUsd(amountAtomic),
    marginFraction,
  };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
