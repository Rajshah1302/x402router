import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Router402 keeps one .env at the repo root; a per-app .env overrides it.
loadEnv({ path: ["../../.env", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
