"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";

/**
 * Stands in front of anything that needs a live session: connect a wallet,
 * then authorize a session once. After that the chat never interrupts again.
 */
export function ConnectGate({ children }: { children: React.ReactNode }) {
  const { status, wallet, error, connect, openSession } = useSession();

  const [accountId, setAccountId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [spendCapUsd, setSpendCapUsd] = useState(5);
  const [perRequestCapUsd, setPerRequestCapUsd] = useState(0.25);
  const [ttlHours, setTtlHours] = useState(24);
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <div className="page">
        <p className="subtitle">Restoring session…</p>
      </div>
    );
  }

  if (status === "session") {
    return <>{children}</>;
  }

  const submit = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch {
      // The provider surfaces the message through `error`.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>{wallet ? "Authorize a session" : "Connect your wallet"}</h1>
      <p className="subtitle">
        Your wallet address is your identity here — there is no account to
        create. You sign once to open a session; every inference request after
        that pays itself.
      </p>

      {error ? (
        <div className="notice" data-tone="error">
          {error}
        </div>
      ) : null}

      {!wallet ? (
        <div className="card">
          <h2>Wallet</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="account">Hedera account id</label>
              <input
                id="account"
                placeholder="0.0.123456"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="key">Private key</label>
              <input
                id="key"
                type="password"
                placeholder="302e0201…"
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
              />
            </div>
          </div>
          <div className="notice">
            The key stays in this browser and is used to sign the session
            authorization and the x402 payments that follow. Use a testnet
            account. A HashPack or WalletConnect connector drops into the same
            interface — see <span className="mono">lib/wallet.ts</span>.
          </div>
          <button
            disabled={busy || !accountId || !privateKey}
            onClick={() => submit(() => connect(accountId, privateKey))}
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <div className="card">
          <h2>Session limits</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="cap">Total spend cap (USDC)</label>
              <input
                id="cap"
                type="number"
                step="0.01"
                min="0.01"
                value={spendCapUsd}
                onChange={(event) => setSpendCapUsd(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="percap">Per-request cap (USDC)</label>
              <input
                id="percap"
                type="number"
                step="0.01"
                min="0.01"
                value={perRequestCapUsd}
                onChange={(event) =>
                  setPerRequestCapUsd(Number(event.target.value))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="ttl">Expires in (hours)</label>
              <input
                id="ttl"
                type="number"
                min="1"
                max="720"
                value={ttlHours}
                onChange={(event) => setTtlHours(Number(event.target.value))}
              />
            </div>
          </div>
          <div className="notice">
            These limits are signed into the authorization, so the gateway
            cannot widen them later. The session stops working the moment either
            cap or the expiry is reached.
          </div>
          <button
            disabled={busy}
            onClick={() =>
              submit(() =>
                openSession({ spendCapUsd, perRequestCapUsd, ttlHours }),
              )
            }
          >
            {busy ? "Signing…" : "Authorize session"}
          </button>
        </div>
      )}
    </div>
  );
}
