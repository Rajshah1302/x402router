import {
  operatorAddress,
  publicClientFor,
  readEnsConfig,
  walletClientFor,
  type EnsConfig,
  type EnsPublicClient,
  type EnsWalletClient,
} from "@router402/ens";
import { logger } from "./logger.js";

/**
 * The gateway's handle on ENSv2.
 *
 * ENS is an optional layer here, and deliberately so: `readEnsConfig()` returns
 * null when the registries have not been deployed, and every caller treats that
 * as "keep the local behaviour" rather than as a failure. A checkout with no
 * Sepolia key still runs, just with a catalogue that cannot be edited without a
 * deploy and sessions that only this database can vouch for.
 */
const config: EnsConfig | null = (() => {
  try {
    return readEnsConfig();
  } catch (error) {
    logger.error({ err: error }, "ENS configuration is invalid; ENS is disabled");
    return null;
  }
})();

let cachedPublic: EnsPublicClient | null = null;
let cachedWallet: EnsWalletClient | null = null;

export function ensConfig(): EnsConfig | null {
  return config;
}

/** True when the gateway can read ENS. */
export function ensReadable(): boolean {
  return config !== null;
}

/** True when the gateway can also register and unregister names. */
export function ensWritable(): boolean {
  return config !== null && config.operatorPrivateKey !== undefined;
}

export function ensPublicClient(): EnsPublicClient | null {
  if (!config) return null;
  cachedPublic ??= publicClientFor(config);
  return cachedPublic;
}

export function ensWalletClient(): EnsWalletClient | null {
  if (!config?.operatorPrivateKey) return null;
  cachedWallet ??= walletClientFor(config);
  return cachedWallet;
}

/** What `/v1/discovery` and the agent card report about the namespace. */
export function ensInfo(): {
  enabled: boolean;
  chain: string;
  parentName: string;
  sessionParentName: string;
  agentRegistry: string;
  sessionRegistry: string;
  operator: string | null;
} | null {
  if (!config) return null;
  return {
    enabled: true,
    chain: "sepolia",
    parentName: config.parentName,
    sessionParentName: config.sessionParentName,
    agentRegistry: config.agentRegistry,
    sessionRegistry: config.sessionRegistry,
    operator: operatorAddress(config),
  };
}
