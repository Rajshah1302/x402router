import { config as loadEnv } from "dotenv";
import { z } from "zod";
import {
  HEDERA_MAINNET_USDC,
  HEDERA_TESTNET_USDC,
  SUPPORTED_HEDERA_NETWORKS,
} from "@x402/hedera";

// One .env at the repo root; a per-app .env overrides it.
loadEnv({ path: ["../../.env", ".env"], quiet: true });

const NetworkSchema = z.enum(
  SUPPORTED_HEDERA_NETWORKS as unknown as [string, ...string[]],
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4021),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),

  X402_NETWORK: NetworkSchema.default("hedera:testnet"),
  X402_FACILITATOR_URL: z.url().default("https://api.testnet.blocky402.com"),
  X402_PAY_TO_ACCOUNT_ID: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "must be a Hedera account id like 0.0.123456"),
  X402_ASSET_ID: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  X402_MARGIN: z.coerce.number().min(0).max(1).default(0.1),

  SESSION_JWT_SECRET: z
    .string()
    .min(32, "SESSION_JWT_SECRET must be at least 32 characters"),
  SESSION_DEFAULT_TTL_HOURS: z.coerce.number().positive().default(24),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid Router402 gateway configuration:\n${issues}`);
}

const raw = parsed.data;

const defaultAsset =
  raw.X402_NETWORK === "hedera:mainnet"
    ? HEDERA_MAINNET_USDC
    : HEDERA_TESTNET_USDC;

export const env = {
  ...raw,
  X402_ASSET_ID: raw.X402_ASSET_ID ?? defaultAsset,
  corsOrigins: raw.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: raw.NODE_ENV === "production",
} as const;

export type Env = typeof env;
