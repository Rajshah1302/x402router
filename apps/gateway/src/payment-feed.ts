import { assetAtomicToUsd } from "@router402/shared";
import { env } from "./env.js";

/**
 * A human-readable line per settlement, printed straight to stdout.
 *
 * The structured pino log is for machines; this is for the demo — run the
 * gateway in one terminal and watch every paid call land while the harness
 * works. Colored only when attached to a TTY so piped logs stay clean.
 */

const COLOR = Boolean(process.stdout.isTTY);

function paint(code: string, text: string): string {
  return COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function formatAmount(amountAtomic: bigint): string {
  const { symbol, decimals } = env.paymentAsset;
  const whole = Number(amountAtomic) / 10 ** decimals;
  const digits = whole >= 1 ? 4 : whole >= 0.001 ? 6 : 8;
  return `${whole.toFixed(digits)} ${symbol}`;
}

export function printSettlement(info: {
  success: boolean;
  transactionId: string | null;
  payer: string | null;
  amountAtomic: bigint;
  model?: string;
}): void {
  const usd = assetAtomicToUsd(info.amountAtomic, env.paymentAsset);
  const usdText = usd < 0.01 ? `$${usd.toFixed(6)}` : `$${usd.toFixed(4)}`;

  const mark = info.success ? paint("32", "✓") : paint("31", "✗");
  const parts = [
    `${mark} ${info.success ? "paid" : "failed"}`,
    paint("1", formatAmount(info.amountAtomic)),
    paint("90", `(~${usdText})`),
  ];
  if (info.model) parts.push(paint("90", info.model));
  if (info.payer) parts.push(paint("90", info.payer));
  if (info.transactionId) parts.push(paint("36", info.transactionId));

  process.stdout.write(`  ${parts.join(paint("90", " · "))}\n`);
}
