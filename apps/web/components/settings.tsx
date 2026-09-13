"use client";

import { useEffect, useState } from "react";
import { NETWORK, fetchModels, type ModelOption } from "@/lib/gateway";
import { atomicToUsd } from "@/lib/asset";
import { LocalKeyWallet } from "@/lib/wallet";
import {
  createHarnessToken,
  listHarnessTokens,
  opencodeConfig,
  revokeHarnessToken,
  type HarnessTokenInfo,
} from "@/lib/harness";
import { useSession } from "@/lib/session-context";

export function Settings() {
  const { wallet, session, token, endSession, disconnect } = useSession();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState(false);

  const [harnessCap, setHarnessCap] = useState(5);
  const [harnessPerRequest, setHarnessPerRequest] = useState(0.25);
  const [harnessTtl, setHarnessTtl] = useState(24);
  const [harnessUrl, setHarnessUrl] = useState<string | null>(null);
  const [harnessTokens, setHarnessTokens] = useState<HarnessTokenInfo[]>([]);
  const [harnessError, setHarnessError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!token) return;
    listHarnessTokens(token).then(setHarnessTokens).catch(() => {});
  }, [token]);

  const spendCap = session ? atomicToUsd(session.spendCapAtomic) : 0;
  const spent = session ? atomicToUsd(session.spentAtomic) : 0;

  const generateHarness = async () => {
    if (!token || !(wallet instanceof LocalKeyWallet)) {
      setHarnessError("Connect a local-key wallet first.");
      return;
    }
    setBusy(true);
    setHarnessError(null);
    try {
      const result = await createHarnessToken(token, wallet, {
        spendCapUsd: harnessCap,
        perRequestCapUsd: harnessPerRequest,
        ttlHours: harnessTtl,
      });
      setHarnessUrl(result.url);
      setHarnessTokens(await listHarnessTokens(token));
    } catch (cause) {
      setHarnessError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await revokeHarnessToken(token, id);
      setHarnessTokens(await listHarnessTokens(token));
    } finally {
      setBusy(false);
    }
  };

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
        <h2>Harness access</h2>
        <p className="subtitle" style={{ marginTop: 0 }}>
          Let opencode, Cursor or any OpenAI-compatible tool use Router402 as a
          provider, paying per call. The gateway holds your key to sign for the
          harness — testnet only, bounded by the caps below.
        </p>

        {harnessError ? (
          <div className="notice" data-tone="error">
            {harnessError}
          </div>
        ) : null}

        <div className="row">
          <div className="field">
            <label htmlFor="hcap">Spend cap (USDC)</label>
            <input
              id="hcap"
              type="number"
              step="0.01"
              min="0.01"
              value={harnessCap}
              onChange={(event) => setHarnessCap(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="hper">Per-request cap (USDC)</label>
            <input
              id="hper"
              type="number"
              step="0.01"
              min="0.01"
              value={harnessPerRequest}
              onChange={(event) =>
                setHarnessPerRequest(Number(event.target.value))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="httl">Session TTL (hours)</label>
            <input
              id="httl"
              type="number"
              min="1"
              max="720"
              value={harnessTtl}
              onChange={(event) => setHarnessTtl(Number(event.target.value))}
            />
          </div>
        </div>

        <button
          disabled={busy || !wallet}
          onClick={() => void generateHarness()}
        >
          {busy ? "Generating…" : "Generate access URL"}
        </button>

        {harnessUrl ? (
          <div style={{ marginTop: 16 }}>
            <label>Access URL</label>
            <div className="row">
              <input
                readOnly
                className="mono"
                value={harnessUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="secondary"
                onClick={() => void navigator.clipboard.writeText(harnessUrl)}
              >
                Copy
              </button>
            </div>
            <p className="subtitle" style={{ marginTop: 12, marginBottom: 6 }}>
              Paste into your opencode config:
            </p>
            <pre
              className="mono"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                overflowX: "auto",
                margin: 0,
              }}
            >
              {opencodeConfig(
                harnessUrl,
                models.map((model) => ({
                  id: model.id,
                  name: model.name,
                  input: model.pricing.prompt_usd_per_mtok,
                  output: model.pricing.completion_usd_per_mtok,
                })),
              )}
            </pre>
          </div>
        ) : null}

        {harnessTokens.length > 0 ? (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Cap</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {harnessTokens.map((info) => (
                <tr key={info.id}>
                  <td className="mono">
                    {new Date(info.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <span className="pill" data-tone={info.active ? "ok" : "bad"}>
                      {info.active ? "active" : "revoked"}
                    </span>
                  </td>
                  <td className="mono">
                    ${atomicToUsd(info.spendCapAtomic).toFixed(2)}
                  </td>
                  <td className="mono">
                    {info.lastUsedAt
                      ? new Date(info.lastUsedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {info.active ? (
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => void revoke(info.id)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
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
