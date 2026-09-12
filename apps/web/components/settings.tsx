"use client";

import { useEffect, useState } from "react";
import { NETWORK, fetchModels, type ModelOption } from "@/lib/gateway";
import { useSession } from "@/lib/session-context";

export function Settings() {
  const { wallet, session, endSession, disconnect } = useSession();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchModels().then(setModels).catch(() => setModels([]));
  }, []);

  const spendCap = session ? Number(session.spendCapAtomic) / 1e6 : 0;
  const spent = session ? Number(session.spentAtomic) / 1e6 : 0;

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="subtitle">
        Your wallet, your session, and what this gateway will route for you.
      </p>

      <section className="card">
        <h2>Account</h2>
        <div className="status">
          <div className="status-row">
            <span>Wallet address</span>
            <span className="mono">{wallet?.accountId ?? "—"}</span>
          </div>
          <div className="status-row">
            <span>Network</span>
            <span className="mono">{NETWORK}</span>
          </div>
          <div className="status-row">
            <span>Connection</span>
            <span className="pill" data-tone={wallet ? "ok" : "bad"}>
              {wallet ? `connected (${wallet.kind})` : "disconnected"}
            </span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="secondary" onClick={disconnect} disabled={!wallet}>
            Disconnect
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Session</h2>
        {session ? (
          <>
            <div className="status">
              <div className="status-row">
                <span>Session id</span>
                <span className="mono">{session.id}</span>
              </div>
              <div className="status-row">
                <span>Status</span>
                <span
                  className="pill"
                  data-tone={session.status === "active" ? "ok" : "bad"}
                >
                  {session.status}
                </span>
              </div>
              <div className="status-row">
                <span>Expires</span>
                <span className="mono">
                  {new Date(session.expiresAt).toLocaleString()}
                </span>
              </div>
              <div className="status-row">
                <span>Spent</span>
                <span className="mono">
                  ${spent.toFixed(6)} of ${spendCap.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="bar-track" style={{ marginTop: 12 }}>
              <div
                className="bar-fill"
                style={{
                  width: spendCap > 0 ? `${(spent / spendCap) * 100}%` : "0%",
                }}
              />
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button
                className="danger"
                disabled={busy || session.status !== "active"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await endSession();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke session
              </button>
            </div>
          </>
        ) : (
          <p className="subtitle" style={{ margin: 0 }}>
            No session. Open one from the Chat tab.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Models</h2>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Context</th>
              <th>Prompt $/MTok</th>
              <th>Completion $/MTok</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id}>
                <td>{model.name}</td>
                <td>{model.provider}</td>
                <td className="mono">
                  {(model.context_length / 1000).toFixed(0)}k
                </td>
                <td className="mono">
                  ${model.pricing.prompt_usd_per_mtok.toFixed(2)}
                </td>
                <td className="mono">
                  ${model.pricing.completion_usd_per_mtok.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="subtitle" style={{ marginTop: 12, marginBottom: 0 }}>
          Prices include the gateway margin and are charged in USDC. Payments
          settle through the Blocky402 facilitator on {NETWORK}.
        </p>
      </section>
    </div>
  );
}
