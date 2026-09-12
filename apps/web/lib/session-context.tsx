"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionInfo } from "@router402/shared";
import {
  createSession,
  fetchCurrentSession,
  revokeSession,
  type SessionTerms,
} from "./gateway";
import { LocalKeyWallet, type Wallet } from "./wallet";
import { createPayingFetch } from "./x402-client";

const STORAGE_KEY = "router402.session.v1";

interface StoredSession {
  token: string;
  accountId: string;
  /** Session key. Held in the browser only; the gateway never sees it. */
  sessionPrivateKey: string;
}

interface SessionState {
  wallet: Wallet | null;
  session: SessionInfo | null;
  token: string | null;
  /** Fetch that settles x402 challenges with the session key. */
  payFetch: typeof fetch | null;
  status: "loading" | "disconnected" | "connected" | "session";
  error: string | null;
  connect(accountId: string, privateKey: string): Promise<void>;
  openSession(terms: SessionTerms): Promise<void>;
  endSession(): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [payFetch, setPayFetch] = useState<typeof fetch | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = useCallback((value: StoredSession | null) => {
    if (typeof window === "undefined") return;
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const activate = useCallback(
    async (stored: StoredSession, info: SessionInfo) => {
      const paying = await createPayingFetch(
        info.sessionAccountId,
        stored.sessionPrivateKey,
        // Cap each signature at whatever the session has left to spend.
        (BigInt(info.spendCapAtomic) - BigInt(info.spentAtomic)).toString(),
      );

      setToken(stored.token);
      setSession(info);
      setPayFetch(() => paying);
      setWallet(await LocalKeyWallet.connect(stored.accountId, stored.sessionPrivateKey));
    },
    [],
  );

  // Restore a live session on reload so the chat does not ask for a signature
  // again after every refresh.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw =
          typeof window === "undefined"
            ? null
            : window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const stored = JSON.parse(raw) as StoredSession;
        const info = await fetchCurrentSession(stored.token);
        if (cancelled) return;

        if (info.status === "active") {
          await activate(stored, info);
        } else {
          store(null);
        }
      } catch {
        store(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activate, store]);

  const connect = useCallback(
    async (accountId: string, privateKey: string) => {
      setError(null);
      try {
        setWallet(await LocalKeyWallet.connect(accountId, privateKey));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [],
  );

  const openSession = useCallback(
    async (terms: SessionTerms) => {
      if (!(wallet instanceof LocalKeyWallet)) {
        throw new Error("Connect a wallet first");
      }
      setError(null);

      try {
        // The MVP reuses the wallet key as the session key: the wallet already
        // lives in this browser, so a separate key would add ceremony without
        // adding isolation. A hardware or extension wallet would generate a
        // fresh key here and sign the authorization with the wallet instead.
        const sessionPrivateKey = wallet.exportPrivateKey();
        const result = await createSession(wallet, sessionPrivateKey, terms);

        const stored: StoredSession = {
          token: result.token,
          accountId: wallet.accountId,
          sessionPrivateKey,
        };

        store(stored);
        await activate(stored, result.session);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [activate, store, wallet],
  );

  const endSession = useCallback(async () => {
    if (!token) return;
    try {
      setSession(await revokeSession(token));
    } finally {
      store(null);
      setToken(null);
      setPayFetch(null);
    }
  }, [store, token]);

  const disconnect = useCallback(() => {
    store(null);
    setWallet(null);
    setSession(null);
    setToken(null);
    setPayFetch(null);
  }, [store]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setSession(await fetchCurrentSession(token));
  }, [token]);

  const status: SessionState["status"] = !ready
    ? "loading"
    : token && session?.status === "active"
      ? "session"
      : wallet
        ? "connected"
        : "disconnected";

  const value = useMemo<SessionState>(
    () => ({
      wallet,
      session,
      token,
      payFetch,
      status,
      error,
      connect,
      openSession,
      endSession,
      disconnect,
      refresh,
    }),
    [
      connect,
      disconnect,
      endSession,
      error,
      openSession,
      payFetch,
      refresh,
      session,
      status,
      token,
      wallet,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return context;
}
