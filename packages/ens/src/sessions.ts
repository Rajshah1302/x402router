import {
  encodeFunctionData,
  zeroAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { registryAbi, resolverAbi } from "./abi.js";
import type { EnsConfig } from "./config.js";
import { labelId, namehash, sessionLabel } from "./names.js";
import { SessionRecords } from "./records.js";
import { SESSION_OWNER_ROLES } from "./roles.js";

/** Registry `Status` enum, mirroring `IPermissionedRegistry.Status`. */
export const NameStatus = {
  AVAILABLE: 0,
  RESERVED: 1,
  REGISTERED: 2,
} as const;

export interface OpenSessionName {
  /** The gateway's session id; the ENS label is derived from it. */
  sessionId: string;
  /**
   * Address that will own the session name.
   *
   * For an ECDSA-backed Hedera account this is the account's EVM alias, so the
   * caller genuinely holds the key to the name and can unregister the session
   * themselves without going through the gateway. Accounts with no EVM alias
   * fall back to the gateway operator.
   */
  owner: `0x${string}`;
  /** Hedera account that authorized the session. */
  walletAddress: string;
  /** Hedera account the session key signs payments from. */
  sessionAccountId: string;
  /** Spend ceilings in the settlement asset's atomic units. */
  capTotalAtomic: bigint;
  capPerRequestAtomic: bigint;
  network: string;
  asset: string;
  expiresAt: Date;
}

export interface SessionNameRef {
  label: string;
  /** Fully-qualified, e.g. `sabc123.keys.router402.eth`. */
  ensName: string;
  registerTx: Hex;
  recordsTx: Hex;
  owner: `0x${string}`;
  expiry: bigint;
}

/**
 * Register a session as a name in the session registry.
 *
 * This is the ENSv2 feature Router402 leans on hardest, because a session and
 * a registry entry are the same object: an owner, an expiry, a revocation, and
 * a set of published terms.
 *
 *   - **Expiring.** The registry stores the expiry and enforces it. An expired
 *     name stops resolving whatever the gateway's own clock or database says.
 *   - **Revocable.** Revoking is `unregister()`. It is a public, ordered fact
 *     anyone can check against the x402 settlements that reference the session,
 *     instead of a `revokedAt` column only the gateway can see.
 *   - **Non-transferable.** The owner is granted `ROLE_UNREGISTER` and nothing
 *     else. Without `ROLE_CAN_TRANSFER_ADMIN` the ERC-1155 token cannot move,
 *     so a session key cannot be sold, lent or delegated onward — and without
 *     `ROLE_RENEW` it cannot extend its own life.
 *
 * The caps are written as records in the same transaction batch. They are
 * published and auditable rather than enforced: the gateway operator holds the
 * root text role on the shared session resolver and could rewrite them. See
 * `docs/ens.md` — that is the honest limit of a gateway-signed design.
 */
export async function openSessionName(
  publicClient: PublicClient,
  walletClient: WalletClient,
  config: EnsConfig,
  params: OpenSessionName,
): Promise<SessionNameRef> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("ENS wallet client has no account configured");
  }

  const label = sessionLabel(params.sessionId);
  const ensName = `${label}.${config.sessionParentName}`;
  const expiry = BigInt(Math.floor(params.expiresAt.getTime() / 1000));

  const registerTx = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.sessionRegistry,
    abi: registryAbi,
    functionName: "register",
    args: [
      label,
      params.owner,
      // A session has no children, so it gets no subregistry.
      zeroAddress,
      config.sessionResolver,
      SESSION_OWNER_ROLES,
      expiry,
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: registerTx });

  const node = namehash(ensName);
  const records: Array<[string, string]> = [
    [SessionRecords.wallet, params.walletAddress],
    [SessionRecords.sessionAccount, params.sessionAccountId],
    [SessionRecords.capTotal, params.capTotalAtomic.toString()],
    [SessionRecords.capPerRequest, params.capPerRequestAtomic.toString()],
    [SessionRecords.network, params.network],
    [SessionRecords.asset, params.asset],
  ];

  const recordsTx = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.sessionResolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [
      records.map(([key, value]) =>
        encodeFunctionData({
          abi: resolverAbi,
          functionName: "setText",
          args: [node, key, value],
        }),
      ),
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: recordsTx });

  return { label, ensName, registerTx, recordsTx, owner: params.owner, expiry };
}

/**
 * Revoke a session by deleting its name.
 *
 * Unlike a database flag this cannot be quietly undone: reviving the label
 * means a fresh registration, with a new token and a new expiry, visible as
 * such on-chain.
 */
export async function revokeSessionName(
  publicClient: PublicClient,
  walletClient: WalletClient,
  config: EnsConfig,
  sessionId: string,
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("ENS wallet client has no account configured");
  }

  const hash = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.sessionRegistry,
    abi: registryAbi,
    functionName: "unregister",
    args: [labelId(sessionLabel(sessionId))],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export interface SessionNameState {
  ensName: string;
  /** One of `NameStatus`. */
  status: number;
  registered: boolean;
  /** True when the registry says this name is live right now. */
  live: boolean;
  expiry: bigint;
  owner: `0x${string}`;
}

/**
 * Read a session's on-chain state.
 *
 * The gateway treats this as the authority on whether a session is still open:
 * the JWT is the fast path, the registry is the truth. A session whose name has
 * been unregistered or has expired is dead regardless of what the token claims.
 */
export async function readSessionNameState(
  publicClient: PublicClient,
  config: EnsConfig,
  sessionId: string,
): Promise<SessionNameState> {
  const label = sessionLabel(sessionId);

  const state = await publicClient.readContract({
    address: config.sessionRegistry,
    abi: registryAbi,
    functionName: "getState",
    args: [labelId(label)],
  });

  const registered = state.status === NameStatus.REGISTERED;
  const now = BigInt(Math.floor(Date.now() / 1000));

  return {
    ensName: `${label}.${config.sessionParentName}`,
    status: state.status,
    registered,
    live: registered && state.expiry > now,
    expiry: state.expiry,
    owner: state.latestOwner,
  };
}
