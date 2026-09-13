/**
 * Create a three-role demo setup for the HTS settlement leg, so the custom fee
 * is visible: a treasury that holds supply and collects the fee, the payer
 * (funded with tokens), and a recipient that receives payments.
 *
 *   bun run scripts/create-demo-token.ts <payerAccountId> <payerKeyFile>
 *
 * Prints the .env values to paste. The payer must be a funded testnet account
 * (it pays for account/token creation).
 */
import { readFileSync } from "node:fs";
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  CustomFractionalFee,
  FeeAssessmentMethod,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TransferTransaction,
} from "@hiero-ledger/sdk";

const [payerIdArg, keyFileArg] = process.argv.slice(2);
if (!payerIdArg || !keyFileArg) {
  console.error(
    "Usage: bun run scripts/create-demo-token.ts <payerAccountId> <payerKeyFile>",
  );
  process.exit(1);
}

const payerKey = PrivateKey.fromStringDer(
  readFileSync(keyFileArg, "utf8").trim(),
);
const client = Client.forTestnet().setOperator(
  AccountId.fromString(payerIdArg),
  payerKey,
);

try {
  const treasuryKey = PrivateKey.generateECDSA();
  const treasuryId = (
    await (
      await new AccountCreateTransaction()
        .setKey(treasuryKey.publicKey)
        .setInitialBalance(new Hbar(20))
        .execute(client)
    ).getReceipt(client)
  ).accountId!.toString();

  const fee = new CustomFractionalFee()
    .setNumerator(1)
    .setDenominator(200)
    .setFeeCollectorAccountId(treasuryId)
    .setAssessmentMethod(FeeAssessmentMethod.Inclusive)
    .setAllCollectorsAreExempt(true);

  const tokenTx = await new TokenCreateTransaction()
    .setTokenName("Router402 Credit")
    .setTokenSymbol("R402")
    .setDecimals(6)
    .setInitialSupply(1_000_000_000_000n)
    .setTreasuryAccountId(treasuryId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setAdminKey(treasuryKey.publicKey)
    .setSupplyKey(treasuryKey.publicKey)
    .setCustomFees([fee])
    .freezeWith(client);
  const tokenId = (
    await (await (await tokenTx.sign(treasuryKey)).execute(client)).getReceipt(client)
  ).tokenId!.toString();

  const recipientKey = PrivateKey.generateECDSA();
  const recipientId = (
    await (
      await new AccountCreateTransaction()
        .setKey(recipientKey.publicKey)
        .setInitialBalance(new Hbar(20))
        .execute(client)
    ).getReceipt(client)
  ).accountId!.toString();

  for (const [id, key] of [
    [recipientId, recipientKey],
    [payerIdArg, payerKey],
  ] as const) {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(id)
      .setTokenIds([TokenId.fromString(tokenId)])
      .freezeWith(client);
    await (await (await tx.sign(key)).execute(client)).getReceipt(client);
  }

  const transferTx = await new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(tokenId), treasuryId, -10_000_000_000n)
    .addTokenTransfer(TokenId.fromString(tokenId), payerIdArg, 10_000_000_000n)
    .freezeWith(client);
  await (await (await transferTx.sign(treasuryKey)).execute(client)).getReceipt(client);

  console.log(`token      = ${tokenId}`);
  console.log(`treasury   = ${treasuryId}   (collects the 0.5% fee)`);
  console.log(`recipient  = ${recipientId}`);
  console.log(`payer      = ${payerIdArg}   (funded 10,000 R402)`);
  console.log("");
  console.log("Set in .env:");
  console.log(`  X402_ASSET_ID="${tokenId}"`);
  console.log(`  X402_ASSET_DECIMALS="6"`);
  console.log(`  X402_PAY_TO_ACCOUNT_ID="${recipientId}"`);
  console.log(`  NEXT_PUBLIC_X402_ASSET="${tokenId}"`);
  console.log(`  NEXT_PUBLIC_X402_ASSET_SYMBOL="R402"`);
  console.log(`  NEXT_PUBLIC_X402_ASSET_DECIMALS="6"`);
  console.log(`  NEXT_PUBLIC_X402_ASSET_USD_PRICE="1"`);
} finally {
  client.close();
}
