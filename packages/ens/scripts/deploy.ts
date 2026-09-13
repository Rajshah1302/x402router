/**
 * One-time setup of the Router402 namespace on the ENSv2 Sepolia beta.
 *
 * Deploys two registry proxies and two resolver proxies through the Verifiable
 * Factory, then wires them into the hierarchy:
 *
 *   router402.eth                     ETHRegistry entry you already own
 *     └── subregistry: AgentRegistry
 *         ├── <model>.router402.eth   one name per agent
 *         └── keys.router402.eth      subregistry: SessionRegistry
 *             └── <session>.keys.router402.eth
 *
 * Prints the env block to paste into .env when it is done. Safe to read before
 * running: every step reports what it is about to do.
 *
 *   bun run --cwd packages/ens ens:deploy
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  zeroAddress,
  type Hex,
} from "viem";
import {
  ENSV2_SEPOLIA,
  REGISTRY_OPERATOR_ROLES,
  RESOLVER_OPERATOR_ROLES,
  labelId,
  registryAbi,
  resolverAbi,
  verifiableFactoryAbi,
} from "../src/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC_URL = process.env.ENS_RPC_URL;
const PARENT_NAME = process.env.ENS_PARENT_NAME;
const OPERATOR_KEY = process.env.ENS_OPERATOR_PRIVATE_KEY;
const SESSION_LABEL = process.env.ENS_SESSION_LABEL ?? "keys";

if (!RPC_URL || !PARENT_NAME || !OPERATOR_KEY) {
  throw new Error(
    "ENS_RPC_URL, ENS_PARENT_NAME and ENS_OPERATOR_PRIVATE_KEY must be set",
  );
}
if (!PARENT_NAME.endsWith(".eth") || PARENT_NAME.split(".").length !== 2) {
  throw new Error(`ENS_PARENT_NAME must be a second-level .eth name, got ${PARENT_NAME}`);
}

const parentLabel = PARENT_NAME.slice(0, -".eth".length);
const account = privateKeyToAccount(OPERATOR_KEY as Hex);

// Public Sepolia endpoints are slow and rate-limit; the defaults give up or
// hang on gas estimation long before the chain is actually the problem.
const transport = http(RPC_URL, { timeout: 60_000, retryCount: 5, retryDelay: 2_000 });

const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

/** Deploy a UUPS proxy and read its address back out of the factory's event. */
async function deployProxy(implementation: Hex, initData: Hex, what: string): Promise<Hex> {
  const salt = BigInt(Math.floor(Math.random() * 2 ** 48));
  console.log(`  deploying ${what}…`);

  const hash = await walletClient.writeContract({
    address: ENSV2_SEPOLIA.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [implementation, salt, initData],
  });
  console.log(`    tx ${hash} — waiting for it to land`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ENSV2_SEPOLIA.verifiableFactory.toLowerCase()) {
      continue;
    }
    try {
      const event = decodeEventLog({
        abi: verifiableFactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName === "ProxyDeployed") {
        console.log(`  ${what} → ${event.args.proxyAddress}`);
        return event.args.proxyAddress;
      }
    } catch {
      // Not the event we are after.
    }
  }

  throw new Error(`${what} deployed in ${hash} but no ProxyDeployed event was found`);
}

async function main(): Promise<void> {
  console.log(`operator      ${account.address}`);
  console.log(`parent name   ${PARENT_NAME}`);

  const owner = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: registryAbi,
    functionName: "getState",
    args: [labelId(parentLabel)],
  });

  if (owner.latestOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `${PARENT_NAME} is owned by ${owner.latestOwner}, not the operator ${account.address}. ` +
        "Register it on the ENSv2 Sepolia beta with this key first.",
    );
  }

  const registryInit = encodeFunctionData({
    abi: registryAbi,
    functionName: "initialize",
    args: [account.address, REGISTRY_OPERATOR_ROLES],
  });
  const resolverInit = encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [account.address, RESOLVER_OPERATOR_ROLES, []],
  });

  console.log("\nproxies");
  const agentRegistry = await deployProxy(ENSV2_SEPOLIA.userRegistryImpl, registryInit, "agent registry");
  const agentResolver = await deployProxy(ENSV2_SEPOLIA.permissionedResolverImpl, resolverInit, "agent resolver");
  const sessionRegistry = await deployProxy(ENSV2_SEPOLIA.userRegistryImpl, registryInit, "session registry");
  const sessionResolver = await deployProxy(ENSV2_SEPOLIA.permissionedResolverImpl, resolverInit, "session resolver");

  console.log("\nwiring");
  console.log(`  ${PARENT_NAME} subregistry → agent registry`);
  const subregistryTx: Hex = await walletClient.writeContract({
    address: ENSV2_SEPOLIA.ethRegistry,
    abi: registryAbi,
    functionName: "setSubregistry",
    args: [labelId(parentLabel), agentRegistry],
  });
  console.log(`    tx ${subregistryTx} — waiting for it to land`);
  await publicClient.waitForTransactionReceipt({ hash: subregistryTx });

  // The session registry hangs off a name inside the agent registry, so the
  // whole namespace is reachable from one parent: session names resolve as
  // <session>.keys.<parent>.
  console.log(`  ${SESSION_LABEL}.${PARENT_NAME} subregistry → session registry`);

  // The agent registry is freshly deployed here, so the label is normally
  // free. It will not be on a re-run after a partial failure, and registering
  // over an existing label reverts — so repoint it instead of dying.
  const keysState = await publicClient.readContract({
    address: agentRegistry,
    abi: registryAbi,
    functionName: "getState",
    args: [labelId(SESSION_LABEL)],
  });

  const REGISTERED = 2;
  const tenYears = BigInt(Math.floor(Date.now() / 1000)) + 10n * 365n * 24n * 60n * 60n;

  const keysTx =
    keysState.status === REGISTERED
      ? await walletClient.writeContract({
          address: agentRegistry,
          abi: registryAbi,
          functionName: "setSubregistry",
          args: [labelId(SESSION_LABEL), sessionRegistry],
        })
      : await walletClient.writeContract({
          address: agentRegistry,
          abi: registryAbi,
          functionName: "register",
          args: [SESSION_LABEL, account.address, sessionRegistry, zeroAddress, 0n, tenYears],
        });

  console.log(`    tx ${keysTx} — waiting for it to land`);
  await publicClient.waitForTransactionReceipt({ hash: keysTx });

  const block = await publicClient.getBlockNumber();

  console.log("\nDone. Add to .env:\n");
  console.log(`ENS_RPC_URL=${RPC_URL}`);
  console.log(`ENS_PARENT_NAME=${PARENT_NAME}`);
  console.log(`ENS_SESSION_LABEL=${SESSION_LABEL}`);
  console.log(`ENS_AGENT_REGISTRY=${agentRegistry}`);
  console.log(`ENS_AGENT_RESOLVER=${agentResolver}`);
  console.log(`ENS_SESSION_REGISTRY=${sessionRegistry}`);
  console.log(`ENS_SESSION_RESOLVER=${sessionResolver}`);
  console.log(`ENS_DEPLOY_BLOCK=${block}`);
  console.log(`ENS_OPERATOR_PRIVATE_KEY=${OPERATOR_KEY}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
