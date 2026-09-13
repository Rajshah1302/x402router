import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Router402 keeps one .env at the repo root; a per-app .env overrides it.
loadEnv({ path: ["../../.env", ".env"], quiet: true });

// `prisma generate` never connects, and runs in environments (CI, Docker,
// Vercel) that have no database. A placeholder keeps generation working; the
// real URL is injected at runtime for `db push` and the gateway itself.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl },
});
