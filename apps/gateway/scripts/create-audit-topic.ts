/**
 * Create the public HCS topic Router402 publishes settlement audits to.
 *
 *   bun run scripts/create-audit-topic.ts <operatorAccountId> <operatorPrivateKey>
 *
 * The topic has no submit key, so anyone can verify (and contribute). The
 * operator key is only set as the admin key so the topic can be cleaned up.
 * Paste the printed topic id into .env as HCS_AUDIT_TOPIC_ID.
 */
import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ["../../.env", ".env"], quiet: true });

const [accountIdArg, privateKeyArg] = process.argv.slice(2);

if (!accountIdArg || !privateKeyArg) {
  console.error(
    "Usage: bun run scripts/create-audit-topic.ts <operatorAccountId> <operatorPrivateKey>",
  );
  process.exit(1);
}

function parsePrivateKey(input: string): PrivateKey {
  const trimmed = input.trim().replace(/^0x/, "");
  const attempts = [
    () => PrivateKey.fromStringDer(trimmed),
    () => PrivateKey.fromStringED25519(trimmed),
    () => PrivateKey.fromStringECDSA(trimmed),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // Try the next encoding.
    }
  }
  throw new Error("Could not read that private key.");
}

const network = process.env.X402_NETWORK ?? "hedera:testnet";
const accountId = AccountId.fromString(accountIdArg);
const key = parsePrivateKey(privateKeyArg);

const client =
  network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(accountId, key);

try {
  const response = await new TopicCreateTransaction()
    .setTopicMemo("Router402 x402 settlement audit")
    .setAdminKey(key.publicKey)
    .execute(client);
  const receipt = await response.getReceipt(client);
  const topicId = receipt.topicId?.toString();

  console.log(`Created public HCS audit topic: ${topicId}`);
  console.log("");
  console.log("Add these to .env:");
  console.log(`  HCS_AUDIT_TOPIC_ID="${topicId}"`);
  console.log(`  HCS_AUDIT_OPERATOR_ID="${accountIdArg}"`);
  console.log(`  HCS_AUDIT_OPERATOR_KEY="<the private key you passed>"`);
} finally {
  client.close();
}
