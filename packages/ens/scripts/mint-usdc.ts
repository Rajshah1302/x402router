/**
 * Mint yourself the test stablecoin that `.eth` registration is priced in.
 *
 * The ENSv2 Sepolia beta charges for names in a mock USDC whose `mint` is open
 * to anyone. It is play money on a testnet and has nothing to do with real
 * USDC — the app shows a USD price because the rent oracle is denominated in
 * USD, not because anything is being charged in real funds.
 *
 * You still need Sepolia ETH for gas; a faucet covers that.
 *
 *   bun run --cwd packages/ens ens:mint-usdc [amount]   # default 100
 */
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { ENSV2_SEPOLIA } from "../src/index.js";

const RPC_URL = process.env.ENS_RPC_URL;
const OPERATOR_KEY = process.env.ENS_OPERATOR_PRIVATE_KEY;

if (!RPC_URL || !OPERATOR_KEY) {
  throw new Error("ENS_RPC_URL and ENS_OPERATOR_PRIVATE_KEY must be set");
}

const amount = parseUnits(process.argv[2] ?? "100", 6);
const account = privateKeyToAccount(OPERATOR_KEY as `0x${string}`);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function mint(address to, uint256 amount)",
]);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

async function main(): Promise<void> {
  const token = ENSV2_SEPOLIA.mockUsdc;

  const gas = await publicClient.getBalance({ address: account.address });
  if (gas === 0n) {
    throw new Error(
      `${account.address} has no Sepolia ETH. Fund it from a faucet first — minting still costs gas.`,
    );
  }

  const before = await publicClient.readContract({
    address: token, abi: erc20, functionName: "balanceOf", args: [account.address],
  });

  const hash = await walletClient.writeContract({
    address: token, abi: erc20, functionName: "mint", args: [account.address, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const after = await publicClient.readContract({
    address: token, abi: erc20, functionName: "balanceOf", args: [account.address],
  });

  console.log(`minted to ${account.address}`);
  console.log(`  ${formatUnits(before, 6)} → ${formatUnits(after, 6)} test USDC`);
  console.log(`  token ${token}`);
  console.log(`  tx    https://sepolia.etherscan.io/tx/${hash}`);
  console.log(`\nAdd the token to your wallet at ${token} (6 decimals) to see it.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
