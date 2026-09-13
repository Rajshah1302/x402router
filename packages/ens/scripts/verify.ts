/**
 * Check that the namespace is wired the way `ens:deploy` intended.
 *
 * Worth running after a deploy and any time resolution goes quiet: the beta is
 * redeployed periodically, and a registry that has been orphaned by a redeploy
 * still answers calls — it just answers about nothing.
 *
 *   bun run --cwd packages/ens ens:verify
 */
import type { EnsConfig } from "../src/index.js";
import {
  ENSV2_SEPOLIA,
  labelId,
  operatorAddress,
  publicClientFor,
  readEnsConfig,
  registryAbi,
  RegistryRoles,
  ResolverRoles,
  ROOT_RESOURCE,
} from "../src/index.js";

const loaded = readEnsConfig();
if (!loaded) {
  throw new Error("ENS is not configured — fill in the ENS_* block in .env first");
}

// Re-bound so the non-null type survives into `main`; TypeScript does not
// carry a module-level guard across a function boundary.
const config: EnsConfig = loaded;
const client = publicClientFor(config);
const operator = operatorAddress(config);

let failures = 0;

function report(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(38)} ${detail}`);
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return (a ?? "").toLowerCase() === b.toLowerCase();
}

async function hasRole(
  contract: `0x${string}`,
  role: bigint,
  account: `0x${string}`,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: contract,
      abi: registryAbi,
      functionName: "hasRoles",
      args: [ROOT_RESOURCE, role, account],
    });
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const parentLabel = config.parentName.split(".")[0];
  if (!parentLabel) throw new Error(`cannot read a label from ${config.parentName}`);
  if (!operator) throw new Error("ENS_OPERATOR_PRIVATE_KEY is not set");

  console.log(`operator  ${operator}`);
  console.log(`parent    ${config.parentName}\n`);

  console.log("ownership");
  const parentState = await client.readContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: registryAbi,
    functionName: "getState",
    args: [labelId(parentLabel)],
  });
  report(
    `${config.parentName} is registered`,
    parentState.status === 2,
    ["AVAILABLE", "RESERVED", "REGISTERED"][parentState.status] ?? String(parentState.status),
  );
  report(
    `${config.parentName} owned by operator`,
    sameAddress(parentState.latestOwner, operator),
    parentState.latestOwner,
  );
  report(
    `${config.parentName} not expired`,
    parentState.expiry > BigInt(Math.floor(Date.now() / 1000)),
    new Date(Number(parentState.expiry) * 1000).toISOString().slice(0, 10),
  );

  console.log("\nhierarchy");
  const parentSub = await client.readContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  });
  report(
    `${config.parentName} → agent registry`,
    sameAddress(parentSub, config.agentRegistry),
    parentSub,
  );

  const keysSub = await client.readContract({
    address: config.agentRegistry,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: [config.sessionLabel],
  });
  report(
    `${config.sessionParentName} → session registry`,
    sameAddress(keysSub, config.sessionRegistry),
    keysSub,
  );

  console.log("\npermissions (root resource)");
  for (const [label, address] of [
    ["agent registry can register", config.agentRegistry],
    ["session registry can register", config.sessionRegistry],
  ] as const) {
    report(label, await hasRole(address, RegistryRoles.REGISTRAR, operator), address);
  }
  for (const [label, address] of [
    ["agent resolver can set text", config.agentResolver],
    ["session resolver can set text", config.sessionResolver],
  ] as const) {
    report(label, await hasRole(address, ResolverRoles.SET_TEXT, operator), address);
  }

  console.log(
    failures === 0
      ? "\nAll good. `ens:publish` next."
      : `\n${failures} check(s) failed — see docs/ens.md before publishing.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
