/**
 * Associate testnet USDC (or any HTS token) with a Hedera account.
 *
 * Hedera requires every account to opt in to an HTS token before it can send
 * or receive it. The Hedera Portal has no button for this, so this script does
 * it directly:
 *
 *   bun run scripts/associate-usdc.ts <accountId> <privateKey> [tokenId]
 *
 * Run it once for the payer wallet and once for the receiving account
 * (`X402_PAY_TO_ACCOUNT_ID`). The token defaults to `X402_ASSET_ID` from the
 * root .env, which is testnet USDC (0.0.429274) unless overridden.
 *
 * Use a throwaway testnet key — this is a dev utility, not something to run
 * against a funded mainnet account.
 */
import {
  AccountId,
  Client,
  PrivateKey,
  Status,
  TokenAssociateTransaction,
  TokenId,
} from "@hiero-ledger/sdk";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ["../../.env", ".env"], quiet: true });

const [accountIdArg, privateKeyArg, tokenIdArg] = process.argv.slice(2);

if (!accountIdArg || !privateKeyArg) {
  console.error(
    "Usage: bun run scripts/associate-usdc.ts <accountId> <privateKey> [tokenId]",
  );
  process.exit(1);
}

const network = process.env.X402_NETWORK ?? "hedera:testnet";
const tokenId = tokenIdArg ?? process.env.X402_ASSET_ID ?? "0.0.429274";

/** Hedera keys turn up as DER, raw ed25519, or 0x-prefixed ECDSA. */
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
  throw new Error(
    "Could not read that private key. Expected DER hex, raw ed25519, or an ECDSA key.",
  );
}

const accountId = AccountId.fromString(accountIdArg);
const key = parsePrivateKey(privateKeyArg);

const client =
  network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
client.setOperator(accountId, key);

try {
  const response = await new TokenAssociateTransaction()
    .setAccountId(accountId)
    .setTokenIds([TokenId.fromString(tokenId)])
    .execute(client);
  const receipt = await response.getReceipt(client);

  if (receipt.status === Status.TokenAlreadyAssociatedToAccount) {
    console.log(
      `${accountId} is already associated with ${tokenId} — nothing to do.`,
    );
  } else {
    console.log(
      `Associated ${tokenId} with ${accountId} (status ${receipt.status.toString()}).`,
    );
  }
} finally {
  client.close();
}
