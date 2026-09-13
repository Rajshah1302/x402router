import { PublicKey } from "@hiero-ledger/sdk";
import { mirrorNodeUrlForNetwork } from "@x402/hedera";
import type { Network } from "@x402/core/types";
import { logger } from "../logger.js";

export class WalletAuthError extends Error {}

/**
 * The message a wallet signs to authorise a session key. Both sides build this
 * string from the same fields, so a signature cannot be replayed against
 * different terms — a different cap, key or expiry produces a different
 * message and therefore a different signature.
 */
export interface SessionAuthorization {
  walletAddress: string;
  sessionAccountId: string;
  sessionPublicKey: string;
  network: string;
  spendCapAtomic: string;
  perRequestCapAtomic: string;
  expiresAt: string;
  nonce: string;
}

export function authorizationMessage(auth: SessionAuthorization): string {
  return [
    "Router402 session authorization",
    `wallet: ${auth.walletAddress}`,
    `session-account: ${auth.sessionAccountId}`,
    `session-key: ${auth.sessionPublicKey}`,
    `network: ${auth.network}`,
    `spend-cap: ${auth.spendCapAtomic}`,
    `per-request-cap: ${auth.perRequestCapAtomic}`,
    `expires: ${auth.expiresAt}`,
    `nonce: ${auth.nonce}`,
  ].join("\n");
}

interface MirrorAccountResponse {
  key?: { _type?: string; key?: string } | null;
  evm_address?: string | null;
}

/**
 * The EVM address a Hedera account maps to, if it has one.
 *
 * ECDSA-backed accounts carry an EVM alias derived from the same key, so the
 * holder can sign for that address on an EVM chain. Router402 uses it as the
 * owner of the session's ENS name: the caller then genuinely owns the name and
 * can unregister the session from Sepolia themselves, without the gateway's
 * help. ED25519 accounts have no such address and return null — those sessions
 * are owned by the gateway operator instead.
 */
export async function evmAddressForAccount(
  accountId: string,
  network: Network,
): Promise<`0x${string}` | null> {
  const base = mirrorNodeUrlForNetwork(network);

  try {
    const response = await fetch(`${base}/api/v1/accounts/${accountId}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as MirrorAccountResponse;
    const address = body.evm_address;

    // Long-zero aliases (0x000…<account num>) are synthesised from the account
    // id rather than derived from a key, so nobody can sign for them.
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
    if (address.toLowerCase().startsWith("0x000000000000000000000000")) {
      return null;
    }

    return address.toLowerCase() as `0x${string}`;
  } catch (error) {
    logger.warn(
      { err: error, accountId },
      "could not read the EVM alias for this account",
    );
    return null;
  }
}

/** Look up the public key Hedera has on record for an account. */
async function fetchAccountKey(
  accountId: string,
  network: Network,
): Promise<PublicKey> {
  const base = mirrorNodeUrlForNetwork(network);
  const response = await fetch(`${base}/api/v1/accounts/${accountId}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new WalletAuthError(
      `Hedera mirror node returned ${response.status} for account ${accountId}`,
    );
  }

  const body = (await response.json()) as MirrorAccountResponse;
  const key = body.key?.key;
  if (!key) {
    throw new WalletAuthError(
      `Account ${accountId} has no single public key on record; it cannot authorise a session this way`,
    );
  }

  switch (body.key?._type) {
    case "ED25519":
      return PublicKey.fromStringED25519(key);
    case "ECDSA_SECP256K1":
      return PublicKey.fromStringECDSA(key);
    default:
      return PublicKey.fromString(key);
  }
}

/**
 * Verify that the connected wallet really authorised this session key.
 *
 * The wallet signs `authorizationMessage(...)` with the key Hedera holds for
 * its account; the gateway checks that signature against the mirror node. The
 * session private key itself never reaches the gateway.
 */
export async function verifySessionAuthorization(
  auth: SessionAuthorization,
  signatureHex: string,
): Promise<void> {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  } catch {
    throw new WalletAuthError("Signature must be hex-encoded");
  }
  if (signature.length === 0) {
    throw new WalletAuthError("Signature is empty");
  }

  const publicKey = await fetchAccountKey(
    auth.walletAddress,
    auth.network as Network,
  );
  const message = Buffer.from(authorizationMessage(auth), "utf8");
  const verified = publicKey.verify(message, signature);

  const onChainKeyDer = publicKey.toStringDer();
  logger.debug(
    {
      walletAddress: auth.walletAddress,
      onChainKeyDer,
      providedSessionKey: auth.sessionPublicKey,
      keysMatch:
        onChainKeyDer.toLowerCase() ===
        auth.sessionPublicKey.toLowerCase(),
      signatureBytes: signature.length,
      message: authorizationMessage(auth),
      verified,
    },
    "session authorization signature check",
  );

  if (!verified) {
    throw new WalletAuthError(
      "Signature does not match the wallet's public key",
    );
  }
}
