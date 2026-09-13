import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { EnsConfig } from "./config.js";

/**
 * Re-exported so consumers can hold a client without taking a direct
 * dependency on viem. The gateway only ever passes these back into this
 * package.
 */
export type EnsPublicClient = PublicClient;
export type EnsWalletClient = WalletClient;

/** Read-only client. Everything the gateway does on the hot path uses this. */
export function publicClientFor(config: EnsConfig): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(config.rpcUrl),
  });
}

export class EnsOperatorError extends Error {}

/**
 * Signing client for the gateway's operator key.
 *
 * Router402 signs ENS transactions on the caller's behalf because callers
 * authenticate with Hedera accounts, which cannot sign a Sepolia transaction.
 * See `docs/ens.md` for what that does and does not buy you — in particular,
 * the operator can rewrite a session's cap records, so the caps are published
 * and auditable rather than cryptographically enforced. Expiry, revocation and
 * non-transferability are enforced by the registry itself.
 */
export function walletClientFor(config: EnsConfig): WalletClient {
  if (!config.operatorPrivateKey) {
    throw new EnsOperatorError(
      "ENS_OPERATOR_PRIVATE_KEY is not set, so this gateway cannot write to ENS",
    );
  }

  return createWalletClient({
    account: privateKeyToAccount(config.operatorPrivateKey),
    chain: sepolia,
    transport: http(config.rpcUrl),
  });
}

/** The address the operator key controls, or `null` when it is not set. */
export function operatorAddress(config: EnsConfig): `0x${string}` | null {
  return config.operatorPrivateKey
    ? privateKeyToAccount(config.operatorPrivateKey).address
    : null;
}
