import {
  decodeAbiParameters,
  encodeFunctionData,
  type PublicClient,
} from "viem";
import { resolverAbi, universalResolverAbi } from "./abi.js";
import type { EnsConfig } from "./config.js";
import { dnsEncode, namehash } from "./names.js";

/**
 * Read text records through the UniversalResolver rather than by calling the
 * resolver directly.
 *
 * This matters for two ENSv2 features Router402 relies on. Wildcard resolution
 * means a name with no resolver of its own is answered by its parent's, and
 * record aliasing (`setAlias`) is only applied on this path — the docs are
 * explicit that calling `text()` straight on the resolver returns empty for an
 * aliased name. Going through the UniversalResolver is what makes
 * `opus.router402.eth` resolve to the records of `claude-opus-5.router402.eth`.
 */
export async function readTexts(
  client: PublicClient,
  config: EnsConfig,
  name: string,
  keys: readonly string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const dnsName = dnsEncode(name);
  const node = namehash(name);

  const results = await client.multicall({
    allowFailure: true,
    contracts: keys.map((key) => ({
      address: config.addresses.universalResolver,
      abi: universalResolverAbi,
      functionName: "resolve" as const,
      args: [
        dnsName,
        encodeFunctionData({
          abi: resolverAbi,
          functionName: "text",
          args: [node, key],
        }),
      ] as const,
    })),
  });

  const records: Record<string, string> = {};

  results.forEach((result, index) => {
    const key = keys[index];
    if (key === undefined) return;
    // A name with no record for this key resolves successfully to empty data;
    // a name that does not resolve at all fails. Both mean "no value", and
    // neither should fail the whole read.
    if (result.status !== "success") return;

    const [encoded] = result.result as readonly [`0x${string}`, `0x${string}`];
    if (encoded === "0x") return;

    try {
      const [value] = decodeAbiParameters([{ type: "string" }], encoded);
      if (value !== "") records[key] = value;
    } catch {
      // Malformed record — skip it rather than discarding the whole name.
    }
  });

  return records;
}

/** Resolve a single text record, or `null` when it is unset. */
export async function readText(
  client: PublicClient,
  config: EnsConfig,
  name: string,
  key: string,
): Promise<string | null> {
  const records = await readTexts(client, config, name, [key]);
  return records[key] ?? null;
}
