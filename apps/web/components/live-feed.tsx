"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalyticsResponse, RecentPayment } from "@router402/shared";
import { formatAsset, formatUsd } from "@/lib/asset";
import { fetchAnalytics } from "@/lib/gateway";
import { hashscanUrl } from "@/lib/hashscan";
import { useSession } from "@/lib/session-context";

/**
 * The demo screen: settlements as they land.
 *
 * Polls the gateway's analytics for the connected wallet and shows each
 * on-chain payment newest-first, with a HashScan link and a running total. Run
 * opencode in another window and watch the money move.
 */
export function LiveFeed() {
  const { payFetch, token } = useSession();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const topId = useRef<string | null>(null);

  useEffect(() => {
    if (!payFetch || !token) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await fetchAnalytics(payFetch, token, 1);
        if (cancelled) return;
        setData(result);
        setError(null);

        const top = result.recentPayments[0]?.id ?? null;
        if (top && top !== topId.current) {
          topId.current = top;
          setPulse((value) => value + 1);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [payFetch, token]);

  const summary = data?.summary;
  const payments = data?.recentPayments ?? [];

  return (
    <div className="page">
      <h1>Live settlements</h1>
      <p className="subtitle">
        Every call the harness makes settles on Hedera. This polls the gateway
        every few seconds.
      </p>

      {error ? (
        <div className="notice" data-tone="error">
          {error}
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Spend (24h)</div>
          <div className="stat-value">
            {formatUsd(summary?.totalSpendUsd ?? 0)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Requests</div>
          <div className="stat-value">{summary?.totalRequests ?? 0}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg / call</div>
          <div className="stat-value">
            {formatUsd(summary?.averageCostUsd ?? 0)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Feed</div>
          <div className="stat-value">
            <span className="live-dot" key={pulse} />
            live
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Recent payments</h2>
        {payments.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            No settlements yet — run a prompt in opencode.
          </p>
        ) : (
          <div className="live-feed">
            {payments.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: RecentPayment }) {
  return (
    <div className="live-row" data-status={payment.status}>
      <span className="live-amount">{formatAsset(payment.amountAtomic)}</span>
      <span className="live-usd">{formatUsd(payment.amountUsd)}</span>
      <span className="live-time">
        {new Date(payment.createdAt).toLocaleTimeString()}
      </span>
      {payment.transactionId ? (
        <a
          className="payflow-tx"
          href={hashscanUrl(payment.transactionId)}
          target="_blank"
          rel="noreferrer"
        >
          {payment.transactionId.slice(0, 22)}… ↗
        </a>
      ) : (
        <span className="mono">{payment.status}</span>
      )}
    </div>
  );
}
