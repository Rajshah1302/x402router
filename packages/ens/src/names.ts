import { keccak256, stringToHex, toHex } from "viem";
import { namehash } from "viem/ens";

export { namehash };

/**
 * DNS wire encoding: each label prefixed by its byte length, terminated by a
 * zero byte. ENSv2 takes names in this form wherever a name (rather than a
 * node hash) is passed — `setAlias`, `authorizeTextRoles`, and every
 * `UniversalResolver` entry point.
 */
export function dnsEncode(name: string): `0x${string}` {
  if (name === "") return "0x00";

  const bytes: number[] = [];
  for (const label of name.split(".")) {
    const encoded = new TextEncoder().encode(label);
    if (encoded.length === 0) {
      throw new Error(`\`${name}\` contains an empty label`);
    }
    if (encoded.length > 255) {
      throw new Error(`label \`${label}\` exceeds 255 bytes`);
    }
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0);

  return toHex(new Uint8Array(bytes));
}

/**
 * A registry addresses its entries by labelhash — the keccak of the label
 * alone, not the namehash of the full name. `register` takes the label as a
 * string; everything afterwards (`unregister`, `getState`, `renew`) takes this.
 */
export function labelhash(label: string): `0x${string}` {
  return keccak256(stringToHex(label));
}

/** The same value as a `uint256`, which is what the registry ABI expects. */
export function labelId(label: string): bigint {
  return BigInt(labelhash(label));
}

/**
 * Reduce a string to a usable DNS label: lowercase, `[a-z0-9-]` only, no
 * leading, trailing or doubled hyphens.
 */
export function toLabel(value: string): string {
  const label = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (label === "") {
    throw new Error(`\`${value}\` does not reduce to a usable ENS label`);
  }
  return label;
}

/**
 * The label an agent is published under.
 *
 * Model ids are OpenRouter-style (`anthropic/claude-opus-5`); the provider
 * prefix is dropped so the name reads as `claude-opus-5.router402.eth`, and
 * dots in version numbers become hyphens because a dot would make it a
 * subdomain. The full id is preserved in the `r402:model` record, so the
 * mapping is never guessed at read time.
 */
export function agentLabel(modelId: string): string {
  const suffix = modelId.includes("/")
    ? modelId.slice(modelId.lastIndexOf("/") + 1)
    : modelId;
  return toLabel(suffix);
}

/**
 * The label a session is published under: short, opaque and unguessable.
 *
 * A session name is public once registered, so the label must not leak the
 * wallet behind it — it is derived from the gateway's own session id, which is
 * already a random cuid.
 */
export function sessionLabel(sessionId: string): string {
  return `s${toLabel(sessionId).slice(-12)}`;
}
