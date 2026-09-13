/**
 * Publish the model catalogue to ENS.
 *
 * Reads `MODELS` from @router402/shared once and writes each model out as a
 * name with price, provider and payment records. After this has run the array
 * is only a seed: the gateway reads the live catalogue back off ENS, and
 * editing a price means a transaction, not a deploy.
 *
 * Re-running updates records in place, so it doubles as "push the new prices".
 *
 *   bun run --cwd packages/ens ens:publish
 */
import { MODELS } from "@router402/shared";
import {
  agentLabel,
  publishAgent,
  publicClientFor,
  readEnsConfig,
  walletClientFor,
} from "../src/index.js";

const PAY_TO = process.env.X402_PAY_TO_ACCOUNT_ID;
const NETWORK = process.env.X402_NETWORK ?? "hedera:testnet";
const ASSET = process.env.X402_ASSET_ID ?? "0.0.429274";
const GATEWAY_URL = process.env.ENS_GATEWAY_URL ?? "http://localhost:4021";

async function main(): Promise<void> {
  const config = readEnsConfig();
  if (!config) {
    throw new Error("ENS is not configured — run ens:deploy first and fill in .env");
  }
  if (!PAY_TO) {
    throw new Error("X402_PAY_TO_ACCOUNT_ID must be set");
  }

  // Two models whose ids differ only by provider would collide on the label,
  // and the second would silently overwrite the first's records.
  const seen = new Map<string, string>();
  for (const model of MODELS) {
    const label = agentLabel(model.id);
    const clash = seen.get(label);
    if (clash) {
      throw new Error(`${model.id} and ${clash} both reduce to the label \`${label}\``);
    }
    seen.set(label, model.id);
  }

  const publicClient = publicClientFor(config);
  const walletClient = walletClientFor(config);

  for (const model of MODELS) {
    const result = await publishAgent(publicClient, walletClient, config, {
      model,
      payTo: PAY_TO,
      network: NETWORK,
      asset: ASSET,
      url: GATEWAY_URL,
    });
    console.log(
      `${result.registerTx ? "registered" : "updated   "} ${result.ensName}`,
    );
  }

  console.log(`\n${MODELS.length} agents published under ${config.parentName}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
