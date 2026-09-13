/**
 * Mint yourself test stablecoins on Sepolia.
 *
 * Registering a name on the ENSv2 beta is priced in USD and settled in a mock
 * stablecoin. Both mocks expose an unguarded `mint(address,uint256)`, so you
 * fund your own wallet rather than hunting for a faucet.
 *
 *   bun run --cwd packages/ens ens:mint          # 1000 test USDC
 *   bun run --cwd packages/ens ens:mint 50 dai   # 50 test DAI
 *
 * Sepolia only, and worthless by construction — this is test money.
 */
import { createPublicClient, createWalletClient, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/** From the ENS deployments table; these are the tokens the beta app accepts. */
const TOKENS = {
  usdc: { address: "0x768f42455a2d082e23ceef7d51e5787c82d67a39", decimals: 6 },
  dai: { address: "0x5472c5725a00b7ba11f0794a79d08ade6f4683bd", decimals: 18 },
} as const satisfies Record<string, { address: `0x${string}`; decimals: number }>;

const erc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const RPC_URL = process.env.ENS_RPC_URL;
const OPERATOR_KEY = process.env.ENS_OPERATOR_PRIVATE_KEY;

if (!RPC_URL || !OPERATOR_KEY) {
  throw new Error("ENS_RPC_URL and ENS_OPERATOR_PRIVATE_KEY must be set");
}

const amount = process.argv[2] ?? "1000";
const symbol = (process.argv[3] ?? "usdc").toLowerCase();

if (!(symbol in TOKENS)) {
  throw new Error(`Unknown token \`${symbol}\`; expected one of ${Object.keys(TOKENS).join(", ")}`);
}

const token = TOKENS[symbol as keyof typeof TOKENS];
const account = privateKeyToAccount(OPERATOR_KEY as Hex);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

async function main(): Promise<void> {
  const value = parseUnits(amount, token.decimals);

  console.log(`minting ${amount} test ${symbol.toUpperCase()} to ${account.address}`);

  const hash = await walletClient.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "mint",
    args: [account.address, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const balance = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  console.log(`tx      ${hash}`);
  console.log(`balance ${Number(balance) / 10 ** token.decimals} ${symbol.toUpperCase()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
