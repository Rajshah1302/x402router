"use client";

import { useEffect, useState } from "react";
import type { AnalyticsResponse, BreakdownRow } from "@router402/shared";
import { fetchAnalytics } from "@/lib/gateway";
import { useSession } from "@/lib/session-context";

const WINDOWS = [7, 30, 90];

export function Analytics() {
  const { payFetch, token } = useSession();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payFetch || !token) return;

    let cancelled = false;
    fetchAnalytics(payFetch, token, days)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [days, payFetch, token]);

  if (error) {
    return (
      <div className="page">
        <div className="notice" data-tone="error">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <p className="subtitle">Loading usage…</p>
      </div>
    );
  }

  const peak = Math.max(...data.spendOverTime.map((b) => b.spendUsd), 0.000001);

  return (
    <div className="page">
      <h1>Analytics</h1>
      <p className="subtitle">
        What your agent consumed and what it paid, for {data.summary.totalRequests}{" "}
        request{data.summary.totalRequests === 1 ? "" : "s"} in the last {days}{" "}
        days.
      </p>

      <div className="row" style={{ marginBottom: 20 }}>
        {WINDOWS.map((window) => (
          <button
            key={window}
            className={window === days ? "" : "secondary"}
            onClick={() => setDays(window)}
          >
            {window}d
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <Stat label="Total spend" value={`$${data.summary.totalSpendUsd.toFixed(4)}`} />
        <Stat label="Requests" value={String(data.summary.totalRequests)} />
        <Stat
          label="Tokens"
          value={(
            data.summary.totalInputTokens + data.summary.totalOutputTokens
          ).toLocaleString()}
        />
        <Stat
          label="Avg / request"
          value={`$${data.summary.averageCostUsd.toFixed(6)}`}
        />
      </div>

      <section className="card">
        <h2>Spend over time</h2>
        {data.spendOverTime.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>
            No spend in this window.
          </p>
        ) : (
          <>
            <div className="spark">
              {data.spendOverTime.map((bucket) => (
                <div
                  key={bucket.date}
                  className="spark-bar"
                  style={{ height: `${(bucket.spendUsd / peak) * 100}%` }}
                  title={`${bucket.date} — $${bucket.spendUsd.toFixed(6)} over ${bucket.requests} requests`}
                />
              ))}
            </div>
            <div
              className="message-meta"
              style={{ justifyContent: "space-between", marginTop: 8 }}
            >
              <span>{data.spendOverTime[0]?.date}</span>
              <span>{data.spendOverTime.at(-1)?.date}</span>
            </div>
          </>
        )}
      </section>

      <Breakdown title="Cost by model" rows={data.byModel} />
      <Breakdown title="Cost by provider" rows={data.byProvider} />

      <section className="card">
        <h2>Recent requests</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Model</th>
              <th>Tokens in / out</th>
              <th>Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.recentRequests.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{row.model}</td>
                <td className="mono">
                  {row.inputTokens} / {row.outputTokens}
                </td>
                <td>${row.costUsd.toFixed(6)}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Recent x402 payments</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Amount</th>
              <th>Asset</th>
              <th>Transaction</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.recentPayments.map((payment) => (
              <tr key={payment.id}>
                <td>{new Date(payment.createdAt).toLocaleString()}</td>
                <td>${payment.amountUsd.toFixed(6)}</td>
                <td className="mono">{payment.asset}</td>
                <td className="mono">{payment.transactionId ?? "—"}</td>
                <td>{payment.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const top = rows[0]?.spendUsd ?? 0;

  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>
          Nothing yet.
        </p>
      ) : (
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td style={{ width: "30%" }}>{row.label}</td>
                <td style={{ width: "40%" }}>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: top > 0 ? `${(row.spendUsd / top) * 100}%` : "0%",
                      }}
                    />
                  </div>
                </td>
                <td className="mono">${row.spendUsd.toFixed(6)}</td>
                <td className="mono">{row.requests} req</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
