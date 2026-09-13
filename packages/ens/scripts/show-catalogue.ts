/**
 * Print the catalogue exactly as the gateway resolves it.
 *
 * Publishing and resolving are different code paths — records are written
 * straight to the resolver, but read back through the UniversalResolver so
 * wildcards and aliases apply. This exercises the read path, so a resolution
 * problem shows up here rather than as a silent fallback to the built-in list
 * at gateway start-up.
 *
 *   bun run --cwd packages/ens ens:catalogue
 */
import {
  publicClientFor,
  readCatalogue,
  readEnsConfig,
} from "../src/index.js";

const loaded = readEnsConfig();
if (!loaded) {
  throw new Error("ENS is not configured — fill in the ENS_* block in .env first");
}

async function main(): Promise<void> {
  const config = loaded!;
  const client = publicClientFor(config);

  console.log(`resolving via UniversalResolver ${config.addresses.universalResolver}`);
  console.log(`under ${config.parentName}, from block ${config.deployBlock}\n`);

  const started = Date.now();
  const agents = await readCatalogue(client, config);
  const elapsed = Date.now() - started;

  if (agents.length === 0) {
    console.log("No agents resolved.");
    console.log("The gateway would fall back to the built-in catalogue here.");
    console.log("Check ENS_DEPLOY_BLOCK is at or before the registrations, and");
    console.log("that ens:verify passes.");
    process.exitCode = 1;
    return;
  }

  for (const agent of agents) {
    console.log(`${agent.ensName}`);
    console.log(`  ${agent.displayName}  (${agent.id} → ${agent.upstreamId})`);
    console.log(`  $${agent.inputPricePerMTok}/$${agent.outputPricePerMTok} per Mtok   ` +
      `ctx ${agent.contextWindow.toLocaleString()}   ` +
      `out ${agent.maxOutputTokens.toLocaleString()}` +
      `${agent.reasoning ? "   reasoning" : ""}`);
    console.log(`  pays ${agent.payTo} on ${agent.network} in ${agent.asset}`);
  }

  console.log(`\n${agents.length} agents resolved in ${elapsed}ms`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
