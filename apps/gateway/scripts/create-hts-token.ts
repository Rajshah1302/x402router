/**
 * Create the HTS settlement token Router402 can charge in, with a custom fee.
 *
 *   bun run scripts/create-hts-token.ts <treasuryAccountId> <treasuryPrivateKey> [symbol]
 *
 * The token carries a 0.5% fractional fee paid to the treasury, so every
 * inference payment also routes a protocol fee on-chain. Hedera assesses that
 * fee at transfer time, outside the signed transfer body, so x402 verification
 * is unaffected — the payer simply needs balance for amount + fee.
 *
 * Paste the printed token id into .env as X402_ASSET_ID.
 */
import {
  AccountId,
  Client,
  CustomFractionalFee,
  FeeAssessmentMethod,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
} from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ["../../.env", ".env"], quiet: true });

const [accountIdArg, privateKeyArg, symbolArg] = process.argv.slice(2);

if (!accountIdArg || !privateKeyArg) {
  console.error(
    "Usage: bun run scripts/create-hts-token.ts <treasuryAccountId> <treasuryPrivateKey> [symbol]",
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
const symbol = symbolArg ?? "R402";
const accountId = AccountId.fromString(accountIdArg);
const key = parsePrivateKey(privateKeyArg);

const client =
  network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(accountId, key);

// 1/200 = 0.5%, collected by the treasury on every transfer.
const fee = new CustomFractionalFee()
  .setNumerator(1)
  .setDenominator(200)
  .setFeeCollectorAccountId(accountId)
  .setAssessmentMethod(FeeAssessmentMethod.Inclusive);

try {
  const response = await new TokenCreateTransaction()
    .setTokenName("Router402 Credit")
    .setTokenSymbol(symbol)
    .setDecimals(6)
    .setInitialSupply(1_000_000_000_000n) // 1,000,000.000000 tokens
    .setTreasuryAccountId(accountId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setAdminKey(key.publicKey)
    .setSupplyKey(key.publicKey)
    .setCustomFees([fee])
    .execute(client);

  const receipt = await response.getReceipt(client);
  const tokenId = receipt.tokenId?.toString();

  console.log(
    `Created HTS token ${tokenId} (${symbol}) with a 0.5% fractional fee to ${accountIdArg}.`,
  );
  console.log("");
  console.log("Add these to .env:");
  console.log(`  X402_ASSET_ID="${tokenId}"`);
  console.log(`  X402_ASSET_DECIMALS="6"`);
} finally {
  client.close();
}
