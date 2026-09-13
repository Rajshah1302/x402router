import {
  encodeFunctionData,
  zeroAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { ModelSpec } from "@router402/shared";
import { registryAbi, resolverAbi } from "./abi.js";
import type { EnsConfig } from "./config.js";
import { agentLabel, dnsEncode, labelId, namehash } from "./names.js";
import { AgentRecords } from "./records.js";
import { bitmap, RegistryRoles } from "./roles.js";
import { NameStatus } from "./sessions.js";

/**
 * Roles an agent's owner holds on its own name: end it, extend it, and move it
 * to a resolver of their own. Enough for a third party to run an agent in this
 * namespace without the operator in the loop — and still no
 * `ROLE_CAN_TRANSFER_ADMIN`, so a listing cannot be sold on.
 */
const AGENT_OWNER_ROLES = bitmap(
  RegistryRoles.UNREGISTER,
  RegistryRoles.RENEW,
  RegistryRoles.SET_RESOLVER,
);

export interface PublishAgent {
  model: ModelSpec;
  /** Hedera account that receives x402 settlement for this agent. */
  payTo: string;
  network: string;
  asset: string;
  /** Base URL of the gateway serving it. */
  url: string;
  /** Who owns the name. Defaults to the operator. */
  owner?: `0x${string}`;
  /** Registration expiry. Agents are long-lived; default is one year out. */
  expiresAt?: Date;
}

const YEAR_SECONDS = 365n * 24n * 60n * 60n;

/** The records that describe an agent, in the order they are written. */
export function agentRecordEntries(
  params: PublishAgent,
): Array<[string, string]> {
  const { model } = params;
  return [
    [AgentRecords.name, model.displayName],
    [AgentRecords.model, model.id],
    [AgentRecords.upstream, model.upstreamId],
    [AgentRecords.provider, model.provider],
    [AgentRecords.priceInput, String(model.inputPricePerMTok)],
    [AgentRecords.priceOutput, String(model.outputPricePerMTok)],
    [AgentRecords.contextWindow, String(model.contextWindow)],
    [AgentRecords.maxOutputTokens, String(model.maxOutputTokens)],
    [AgentRecords.reasoning, model.reasoning ? "true" : "false"],
    [AgentRecords.payTo, params.payTo],
    [AgentRecords.network, params.network],
    [AgentRecords.asset, params.asset],
    [AgentRecords.url, params.url],
  ];
}

export interface PublishedAgent {
  label: string;
  ensName: string;
  /** Null when the name was already registered and only records were updated. */
  registerTx: Hex | null;
  recordsTx: Hex;
}

/**
 * Publish a model as a name in the agent registry.
 *
 * This is what stops the catalogue from being a constant in the source tree.
 * The price, the upstream id, the Hedera account that gets paid and the
 * endpoint that serves it all live in records on the name, so the gateway
 * reads its own catalogue at runtime and anyone holding a name in this
 * registry can list an agent without a code change.
 *
 * Re-publishing an existing name updates its records in place rather than
 * failing, so this is safe to run repeatedly as prices change.
 */
export async function publishAgent(
  publicClient: PublicClient,
  walletClient: WalletClient,
  config: EnsConfig,
  params: PublishAgent,
): Promise<PublishedAgent> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("ENS wallet client has no account configured");
  }

  const label = agentLabel(params.model.id);
  const ensName = `${label}.${config.parentName}`;
  const owner = params.owner ?? account.address;

  const state = await publicClient.readContract({
    address: config.agentRegistry,
    abi: registryAbi,
    functionName: "getState",
    args: [labelId(label)],
  });

  let registerTx: Hex | null = null;

  if (state.status !== NameStatus.REGISTERED) {
    const expiry = params.expiresAt
      ? BigInt(Math.floor(params.expiresAt.getTime() / 1000))
      : BigInt(Math.floor(Date.now() / 1000)) + YEAR_SECONDS;

    registerTx = await walletClient.writeContract({
      account,
      chain: walletClient.chain,
      address: config.agentRegistry,
      abi: registryAbi,
      functionName: "register",
      args: [
        label,
        owner,
        zeroAddress,
        config.agentResolver,
        AGENT_OWNER_ROLES,
        expiry,
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: registerTx });
  }

  const node = namehash(ensName);

  const recordsTx = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.agentResolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [
      agentRecordEntries(params).map(([key, value]) =>
        encodeFunctionData({
          abi: resolverAbi,
          functionName: "setText",
          args: [node, key, value],
        }),
      ),
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash: recordsTx });

  return { label, ensName, registerTx, recordsTx };
}

/**
 * Let `account` edit exactly the named text records on one agent, and nothing
 * else.
 *
 * This is the fine-grained half of Enhanced Access Control: the role is scoped
 * to `keccak(node, keccak(key))`, not to the name and not to the contract. A
 * provider can be handed control of its own `r402:price:input` without being
 * able to touch the `x402:pay-to` that decides where the money goes, or any
 * other name in the registry.
 */
export async function delegateAgentRecords(
  publicClient: PublicClient,
  walletClient: WalletClient,
  config: EnsConfig,
  params: {
    ensName: string;
    keys: readonly string[];
    account: `0x${string}`;
    grant?: boolean;
  },
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("ENS wallet client has no account configured");
  }

  const dnsName = dnsEncode(params.ensName);
  const grant = params.grant ?? true;

  const hash = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.agentResolver,
    abi: resolverAbi,
    functionName: "multicall",
    args: [
      params.keys.map((key) =>
        encodeFunctionData({
          abi: resolverAbi,
          functionName: "authorizeTextRoles",
          args: [dnsName, key, params.account, grant],
        }),
      ),
    ],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Point one agent name at another's records.
 *
 * Aliasing lives in the resolver, so `opus.router402.eth` and
 * `claude-opus-5.router402.eth` return byte-identical records forever without
 * a second copy to keep in sync. Only the UniversalResolver read path applies
 * it, which is why `readTexts` never calls a resolver directly.
 */
export async function aliasAgent(
  publicClient: PublicClient,
  walletClient: WalletClient,
  config: EnsConfig,
  params: { fromName: string; toName: string },
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("ENS wallet client has no account configured");
  }

  const hash = await walletClient.writeContract({
    account,
    chain: walletClient.chain,
    address: config.agentResolver,
    abi: resolverAbi,
    functionName: "setAlias",
    args: [dnsEncode(params.fromName), dnsEncode(params.toName)],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
