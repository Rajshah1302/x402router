import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Hedera SDK is pulled in only by browser-side payment code; keeping it
  // out of the server bundle avoids bundling its gRPC/protobuf transport.
  serverExternalPackages: ["@hiero-ledger/sdk"],
};

export default nextConfig;
