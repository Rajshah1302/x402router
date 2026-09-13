import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { ENSV2_SEPOLIA } from "./addresses.js";

// Matches the gateway: one .env at the repo root, overridden per app. Safe to
// call again — dotenv never overwrites a variable that is already set.
loadEnv({ path: ["../../.env", ".env"], quiet: true });

const Address = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 20-byte hex address")
  .transform((value) => value as `0x${string}`);

const PrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
  .transform((value) => value as `0x${string}`);

const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const EnsEnvSchema = z.object({
  ENS_RPC_URL: blankAsUndefined(z.url()),
  /** The name Router402 owns on the ENSv2 ETHRegistry, e.g. `router402.eth`. */
  ENS_PARENT_NAME: blankAsUndefined(z.string().min(3)),
  /** UserRegistry proxy holding agent names, the subregistry of the parent. */
  ENS_AGENT_REGISTRY: blankAsUndefined(Address),
  /** PermissionedResolver proxy serving agent records. */
  ENS_AGENT_RESOLVER: blankAsUndefined(Address),
  /** UserRegistry proxy holding session names. */
  ENS_SESSION_REGISTRY: blankAsUndefined(Address),
  /** PermissionedResolver proxy serving session records. */
  ENS_SESSION_RESOLVER: blankAsUndefined(Address),
  /** Label under the parent whose subregistry is the session registry. */
  ENS_SESSION_LABEL: z.string().min(1).default("keys"),
  /** Sepolia key the gateway registers and unregisters names with. */
  ENS_OPERATOR_PRIVATE_KEY: blankAsUndefined(PrivateKey),
  /** Block to start scanning `LabelRegistered` from when listing agents. */
  ENS_DEPLOY_BLOCK: blankAsUndefined(z.coerce.bigint()),
});

export interface EnsConfig {
  rpcUrl: string;
  parentName: string;
  agentRegistry: `0x${string}`;
  agentResolver: `0x${string}`;
  sessionRegistry: `0x${string}`;
  sessionResolver: `0x${string}`;
  sessionLabel: string;
  /** `keys.router402.eth` — the parent every session name hangs off. */
  sessionParentName: string;
  operatorPrivateKey?: `0x${string}`;
  deployBlock: bigint;
  addresses: typeof ENSV2_SEPOLIA;
}

/**
 * Reads the ENS configuration, or returns `null` when it is not set up.
 *
 * ENS is an optional layer: without it the gateway keeps its in-process model
 * catalogue and database-only sessions, so the repo still runs for anyone who
 * has not deployed the registries. Every call site treats `null` as "fall back
 * to local behaviour" rather than as an error.
 */
export function readEnsConfig(env: NodeJS.ProcessEnv = process.env): EnsConfig | null {
  const parsed = EnsEnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Router402 ENS configuration:\n${issues}`);
  }

  const raw = parsed.data;

  if (
    !raw.ENS_RPC_URL ||
    !raw.ENS_PARENT_NAME ||
    !raw.ENS_AGENT_REGISTRY ||
    !raw.ENS_AGENT_RESOLVER ||
    !raw.ENS_SESSION_REGISTRY ||
    !raw.ENS_SESSION_RESOLVER
  ) {
    return null;
  }

  return {
    rpcUrl: raw.ENS_RPC_URL,
    parentName: raw.ENS_PARENT_NAME,
    agentRegistry: raw.ENS_AGENT_REGISTRY,
    agentResolver: raw.ENS_AGENT_RESOLVER,
    sessionRegistry: raw.ENS_SESSION_REGISTRY,
    sessionResolver: raw.ENS_SESSION_RESOLVER,
    sessionLabel: raw.ENS_SESSION_LABEL,
    sessionParentName: `${raw.ENS_SESSION_LABEL}.${raw.ENS_PARENT_NAME}`,
    ...(raw.ENS_OPERATOR_PRIVATE_KEY
      ? { operatorPrivateKey: raw.ENS_OPERATOR_PRIVATE_KEY }
      : {}),
    deployBlock: raw.ENS_DEPLOY_BLOCK ?? 0n,
    addresses: ENSV2_SEPOLIA,
  };
}
