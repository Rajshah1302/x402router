import type { PublicClient } from "viem";
import type { ModelSpec, ProviderId } from "@router402/shared";
import { registryAbi } from "./abi.js";
import type { EnsConfig } from "./config.js";
import { labelId } from "./names.js";
import { AgentRecords } from "./records.js";
import { readTexts } from "./resolve.js";

/**
 * A model published as an ENS name.
 *
 * The `ModelSpec` half is what the gateway already understood; the rest is what
 * only ENS knows — where the name lives, and the payment terms the name itself
 * advertises, which is what lets a third party publish an agent under this
 * namespace without a change to Router402's source.
 */
export interface EnsAgent extends ModelSpec {
  /** Fully-qualified name, e.g. `claude-opus-5.router402.eth`. */
  ensName: string;
  /** Hedera account this agent settles to, from `x402:pay-to`. */
  payTo: string | null;
  network: string | null;
  asset: string | null;
  url: string | null;
}

const AGENT_KEYS = Object.values(AgentRecords);

const PROVIDERS: readonly ProviderId[] = ["anthropic", "google"];

function toProviderId(value: string | undefined): ProviderId | null {
  return PROVIDERS.find((provider) => provider === value) ?? null;
}

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turn a name's records into a `ModelSpec`, or return `null` if they do not
 * describe a usable agent.
 *
 * Anything published under the namespace can claim to be an agent, so this is
 * a validation boundary, not a parse: a name missing a price, a provider or an
 * upstream id is skipped rather than half-loaded into the catalogue.
 */
export function agentFromRecords(
  ensName: string,
  records: Record<string, string>,
): EnsAgent | null {
  const id = records[AgentRecords.model];
  const provider = toProviderId(records[AgentRecords.provider]);
  const upstreamId = records[AgentRecords.upstream];
  const inputPricePerMTok = toInt(records[AgentRecords.priceInput]);
  const outputPricePerMTok = toInt(records[AgentRecords.priceOutput]);
  const contextWindow = toInt(records[AgentRecords.contextWindow]);
  const maxOutputTokens = toInt(records[AgentRecords.maxOutputTokens]);

  if (
    !id ||
    !provider ||
    !upstreamId ||
    inputPricePerMTok === null ||
    outputPricePerMTok === null ||
    contextWindow === null ||
    maxOutputTokens === null
  ) {
    return null;
  }

  return {
    id,
    upstreamId,
    provider,
    displayName: records[AgentRecords.name] ?? id,
    contextWindow,
    maxOutputTokens,
    inputPricePerMTok,
    outputPricePerMTok,
    reasoning: records[AgentRecords.reasoning] === "true",
    ensName,
    payTo: records[AgentRecords.payTo] ?? null,
    network: records[AgentRecords.network] ?? null,
    asset: records[AgentRecords.asset] ?? null,
    url: records[AgentRecords.url] ?? null,
  };
}

/**
 * List the labels currently registered in the agent registry.
 *
 * ENS registries are not enumerable, so the set of names is reconstructed from
 * `LabelRegistered` logs and then filtered by on-chain state — a name that has
 * since expired or been unregistered reports a status other than REGISTERED
 * and drops out. That keeps the listing honest without a database of names.
 */
export async function listAgentLabels(
  client: PublicClient,
  config: EnsConfig,
): Promise<string[]> {
  const logs = await client.getContractEvents({
    address: config.agentRegistry,
    abi: registryAbi,
    eventName: "LabelRegistered",
    fromBlock: config.deployBlock,
    toBlock: "latest",
  });

  const labels = [
    ...new Set(
      logs
        .map((log) => log.args.label)
        .filter((label): label is string => typeof label === "string"),
    ),
    // The session registry hangs off a name in this registry; it is a
    // namespace, not an agent.
  ].filter((label) => label !== config.sessionLabel);

  if (labels.length === 0) return [];

  const states = await client.multicall({
    allowFailure: true,
    contracts: labels.map((label) => ({
      address: config.agentRegistry,
      abi: registryAbi,
      functionName: "getState" as const,
      args: [labelId(label)] as const,
    })),
  });

  const REGISTERED = 2;

  return labels.filter((_label, index) => {
    const state = states[index];
    return state?.status === "success" && state.result.status === REGISTERED;
  });
}

/**
 * Read the whole catalogue off ENS.
 *
 * Names whose records do not describe a usable agent are skipped, so one
 * malformed publication cannot take the catalogue down.
 */
export async function readCatalogue(
  client: PublicClient,
  config: EnsConfig,
): Promise<EnsAgent[]> {
  const labels = await listAgentLabels(client, config);

  const agents = await Promise.all(
    labels.map(async (label) => {
      const ensName = `${label}.${config.parentName}`;
      const records = await readTexts(client, config, ensName, AGENT_KEYS);
      return agentFromRecords(ensName, records);
    }),
  );

  return agents
    .filter((agent): agent is EnsAgent => agent !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}
