import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Router402 keeps one .env at the repo root; Next only looks in this app
// directory, so load the root file explicitly and inline the public values
// into the client bundle. Without this the web silently falls back to the
// default asset and its x402 spend controls reject the gateway's requirements.
loadEnv({ path: ["../../.env", ".env"], quiet: true });

const nextConfig: NextConfig = {
  // The Hedera SDK is pulled in only by browser-side payment code; keeping it
  // out of the server bundle avoids bundling its gRPC/protobuf transport.
  serverExternalPackages: ["@hiero-ledger/sdk"],
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL ?? "",
    NEXT_PUBLIC_X402_NETWORK: process.env.NEXT_PUBLIC_X402_NETWORK ?? "",
    NEXT_PUBLIC_X402_ASSET: process.env.NEXT_PUBLIC_X402_ASSET ?? "",
    NEXT_PUBLIC_X402_ASSET_SYMBOL:
      process.env.NEXT_PUBLIC_X402_ASSET_SYMBOL ?? "",
    NEXT_PUBLIC_X402_ASSET_DECIMALS:
      process.env.NEXT_PUBLIC_X402_ASSET_DECIMALS ?? "",
    NEXT_PUBLIC_X402_ASSET_USD_PRICE:
      process.env.NEXT_PUBLIC_X402_ASSET_USD_PRICE ?? "",
  },
};

export default nextConfig;
