/**
 * Client-side view of the settlement asset.
 *
 * The gateway quotes in the asset's smallest units; to show a USD figure the
 * browser needs the same decimals and USD price, so they are mirrored from the
 * public env at build time. Keep these in step with the gateway's
 * `X402_ASSET_ID` / `X402_ASSET_DECIMALS` / `X402_HBAR_USD_PRICE`.
 */
const ASSET_ID = process.env.NEXT_PUBLIC_X402_ASSET ?? "0.0.0";
const isHbar = ASSET_ID === "0.0.0";

export const ASSET = {
  id: ASSET_ID,
  symbol:
    process.env.NEXT_PUBLIC_X402_ASSET_SYMBOL ?? (isHbar ? "HBAR" : "USDC"),
  decimals: Number(
    process.env.NEXT_PUBLIC_X402_ASSET_DECIMALS ?? (isHbar ? "8" : "6"),
  ),
  usdPrice: Number(
    process.env.NEXT_PUBLIC_X402_ASSET_USD_PRICE ?? (isHbar ? "0.05" : "1"),
  ),
} as const;

/** USD value of an amount in the asset's smallest units. */
export function atomicToUsd(atomic: string | number | bigint): number {
  return (Number(atomic) / 10 ** ASSET.decimals) * ASSET.usdPrice;
}

/** Format an amount in the asset's smallest units, e.g. "1.129 HBAR". */
export function formatAsset(atomic: string | number | bigint): string {
  const whole = Number(atomic) / 10 ** ASSET.decimals;
  const decimals = whole >= 1 ? 3 : whole >= 0.001 ? 6 : 8;
  return `${whole.toFixed(decimals)} ${ASSET.symbol}`;
}

/** Format a USD figure, e.g. "$0.056". */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}
