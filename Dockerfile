bun run --cwd packages/ens ens:verify # Router402 gateway — single-stage image so the workspace install, the shared
# build, `prisma generate`, and the tsc build all share one node_modules tree.
# The generated Prisma client lives under src/generated (gitignored), so it must
# be regenerated here before the gateway compiles.
FROM oven/bun:1.3.6

WORKDIR /app

COPY . .

RUN bun install

# packages/shared must be built before the gateway's tsc resolves its types.
RUN bun run --filter @router402/shared build

# The gateway's build script runs `prisma generate` first (the generated client
# is gitignored), then tsc.
RUN bun run --filter @router402/gateway build

ENV NODE_ENV=production
EXPOSE 4021

CMD ["node", "apps/gateway/dist/index.js"]
