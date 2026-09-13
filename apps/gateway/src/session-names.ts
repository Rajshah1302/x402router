import {
  openSessionName,
  readSessionNameState,
  revokeSessionName,
  operatorAddress,
  type SessionNameState,
} from "@router402/ens";
import { evmAddressForAccount } from "./auth/wallet.js";
import { ensConfig, ensPublicClient, ensWalletClient } from "./ens.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import type { Network } from "@x402/core/types";

/**
 * The on-chain half of a session.
 *
 * A session and an ENSv2 registry entry are the same shape — an owner, an
 * expiry, a revocation and a set of published terms — so Router402 keeps them
 * as one object rather than two. The database row stays because the gateway
 * needs somewhere to count spend, but the questions "is this session still
 * open" and "when does it end" are answered by the registry.
 *
 * Every function here degrades rather than throws. A Sepolia outage must not
 * stop someone from opening a session and paying for inference on Hedera, so a
 * failure to register leaves `ensName` null and the session behaves exactly as
 * it did before ENS existed.
 */

export interface RegisteredSessionName {
  ensName: string;
  owner: string;
}

export async function registerSessionName(params: {
  sessionId: string;
  walletAddress: string;
  sessionAccountId: string;
  capTotalAtomic: bigint;
  capPerRequestAtomic: bigint;
  expiresAt: Date;
}): Promise<RegisteredSessionName | null> {
  const config = ensConfig();
  const publicClient = ensPublicClient();
  const walletClient = ensWalletClient();

  if (!config || !publicClient || !walletClient) return null;

  try {
    // Prefer the caller's own EVM alias, so the name belongs to them and they
    // can burn the session without asking the gateway. Accounts with no alias
    // fall back to the operator, which keeps revocation working.
    const owner =
      (await evmAddressForAccount(
        params.walletAddress,
        env.X402_NETWORK as Network,
      )) ?? operatorAddress(config);

    if (!owner) return null;

    const result = await openSessionName(publicClient, walletClient, config, {
      sessionId: params.sessionId,
      owner,
      walletAddress: params.walletAddress,
      sessionAccountId: params.sessionAccountId,
      capTotalAtomic: params.capTotalAtomic,
      capPerRequestAtomic: params.capPerRequestAtomic,
      network: env.X402_NETWORK,
      asset: env.X402_ASSET_ID,
      expiresAt: params.expiresAt,
    });

    logger.info(
      {
        sessionId: params.sessionId,
        ensName: result.ensName,
        owner,
        registerTx: result.registerTx,
      },
      "session registered on ENS",
    );

    return { ensName: result.ensName, owner };
  } catch (error) {
    logger.error(
      { err: error, sessionId: params.sessionId },
      "could not register the session name; continuing without its on-chain half",
    );
    return null;
  }
}

/**
 * Cached liveness answers, so an ENS read does not ride on every inference
 * request. Short enough that a revocation takes effect within seconds; long
 * enough that a burst of calls costs one RPC round trip.
 */
const LIVENESS_TTL_MS = 15_000;
const liveness = new Map<string, { live: boolean; checkedAt: number }>();

/** Burn the session's name. Returns false when ENS could not be reached. */
export async function unregisterSessionName(sessionId: string): Promise<boolean> {
  const config = ensConfig();
  const publicClient = ensPublicClient();
  const walletClient = ensWalletClient();

  if (!config || !publicClient || !walletClient) return false;

  try {
    const hash = await revokeSessionName(
      publicClient,
      walletClient,
      config,
      sessionId,
    );
    logger.info({ sessionId, tx: hash }, "session name unregistered");
    liveness.set(sessionId, { live: false, checkedAt: Date.now() });
    return true;
  } catch (error) {
    logger.error(
      { err: error, sessionId },
      "could not unregister the session name; it will lapse at its expiry",
    );
    return false;
  }
}

/**
 * Ask the registry whether a session is still live.
 *
 * Returns null when ENS cannot answer — unreachable, or not configured — and
 * callers treat that as "no opinion" rather than as a revocation. A chain the
 * gateway cannot read must not lock every caller out.
 */
export async function readSessionName(
  sessionId: string,
): Promise<SessionNameState | null> {
  const config = ensConfig();
  const publicClient = ensPublicClient();

  if (!config || !publicClient) return null;

  try {
    return await readSessionNameState(publicClient, config, sessionId);
  } catch (error) {
    logger.warn(
      { err: error, sessionId },
      "could not read the session name from ENS",
    );
    return null;
  }
}

/**
 * Whether the registry still considers this session open.
 *
 * `true` means live; `false` means the name is gone or expired; `null` means
 * ENS had no answer, and the caller should fall back to the database. That
 * three-way result is the point — an unreachable Sepolia must not revoke
 * everybody's session, and a reachable one must be believed over a stale row.
 */
export async function isSessionNameLive(
  sessionId: string,
): Promise<boolean | null> {
  if (!ensConfig()) return null;

  const cached = liveness.get(sessionId);
  if (cached && Date.now() - cached.checkedAt < LIVENESS_TTL_MS) {
    return cached.live;
  }

  const state = await readSessionName(sessionId);
  if (!state) return null;

  liveness.set(sessionId, { live: state.live, checkedAt: Date.now() });
  return state.live;
}
