"use client";

import { ASSET, atomicToUsd, formatAsset, formatUsd } from "@/lib/asset";
import { hashscanUrl } from "@/lib/hashscan";
import type {
  PaymentChallenge,
  PaymentPhase,
  PaymentSettlement,
} from "@/lib/x402-flow";

/**
 * The x402 payment, made visible.
 *
 * A compact pipeline that lights up as the handshake really happens — quote,
 * sign, settle, stream — then collapses to a one-line receipt with the Hedera
 * transaction id. Steps are driven by real events, not a timer.
 */

const STEPS = [
  { key: "quote", label: "402 quote" },
  { key: "sign", label: "Sign" },
  { key: "settle", label: "Settle" },
  { key: "stream", label: "Stream" },
] as const;

/** Which step is active for each phase. */
const PHASE_STEP: Record<PaymentPhase, number> = {
  quoting: 0,
  challenge: 0,
  signing: 1,
  settling: 2,
  settled: 3,
};

export interface PaymentFlowProps {
  phase: PaymentPhase;
  challenge?: PaymentChallenge;
  settlement?: PaymentSettlement;
  /** The completion has finished streaming — collapse to the receipt. */
  done?: boolean;
  failed?: string;
  elapsedMs?: number;
}

export function PaymentFlow({
  phase,
  challenge,
  settlement,
  done = false,
  failed,
  elapsedMs,
}: PaymentFlowProps) {
  const activeIndex = PHASE_STEP[phase];
  const allDone = done && !failed;

  const amount = challenge ? formatAsset(challenge.amountAtomic) : null;
  const usd = challenge ? formatUsd(atomicToUsd(challenge.amountAtomic)) : null;
  const txId = settlement?.transactionId ?? null;

  if (failed) {
    return (
      <div className="payflow" data-state="failed">
        <span className="payflow-receipt">
          <span className="payflow-dot" data-tone="bad" />
          payment failed · {failed}
        </span>
      </div>
    );
  }

  if (allDone && txId) {
    return (
      <div className="payflow" data-state="done">
        <span className="payflow-receipt">
          <span className="payflow-dot" data-tone="ok">✓</span>
          paid {amount}
          {usd ? <span className="payflow-usd"> ({usd})</span> : null}
          {elapsedMs !== undefined ? (
            <span className="payflow-usd"> · {(elapsedMs / 1000).toFixed(1)}s</span>
          ) : null}
          <a
            className="payflow-tx"
            href={hashscanUrl(txId)}
            target="_blank"
            rel="noreferrer"
          >
            {txId.slice(0, 22)}… ↗
          </a>
        </span>
      </div>
    );
  }

  return (
    <div className="payflow" data-state="running">
      <div className="payflow-track">
        {STEPS.map((step, index) => {
          const state =
            index < activeIndex
              ? "done"
              : index === activeIndex
                ? "active"
                : "pending";
          return (
            <div className="payflow-step" key={step.key} data-state={state}>
              {index > 0 ? (
                <span
                  className="payflow-connector"
                  data-filled={index <= activeIndex}
                />
              ) : null}
              <span className="payflow-node" data-state={state}>
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className="payflow-label">{step.label}</span>
            </div>
          );
        })}
      </div>

      <div className="payflow-detail">
        {phase === "quoting" ? <span>requesting a quote…</span> : null}
        {phase === "challenge" && amount ? (
          <span>
            {amount} {usd ? <span className="payflow-usd">({usd})</span> : null}
            {" · "}
            <span className="mono">{ASSET.symbol}</span>
            {" to "}
            <span className="mono">{challenge?.payTo}</span>
          </span>
        ) : null}
        {phase === "signing" ? (
          <span>session key signing the payment…</span>
        ) : null}
        {phase === "settling" ? (
          <span className="payflow-settling">settling on Hedera…</span>
        ) : null}
        {phase === "settled" ? (
          <span>
            settled
            {txId ? (
              <>
                {" · "}
                <a
                  className="payflow-tx"
                  href={hashscanUrl(txId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {txId.slice(0, 22)}… ↗
                </a>
              </>
            ) : null}
            {" · streaming"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
