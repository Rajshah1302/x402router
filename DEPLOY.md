# Deploying Router402

Two services and a database:

| Piece | Host | Notes |
|---|---|---|
| Gateway (`apps/gateway`) | Railway | Built from the root `Dockerfile`; `railway.json` sets the start command + pre-deploy `db:push` |
| Web (`apps/web`) | Vercel | Root Directory `apps/web`; `apps/web/vercel.json` sets install/build |
| Postgres | Neon | Pooled connection string |

`NEXT_PUBLIC_*` values are **inlined at build time**, so changing the gateway URL
requires a Vercel rebuild.

---

## 0. Push

```bash
git push origin main
```

## 1. Neon

Create a project, copy the **pooled** connection string → `DATABASE_URL`.

## 2. Railway (gateway)

New project → Deploy from GitHub → your fork. Railway reads `railway.json` +
`Dockerfile` from the repo root.

Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled string |
| `DEEPSEEK_API_KEY` | your DeepSeek key |
| `X402_NETWORK` | `hedera:testnet` |
| `X402_FACILITATOR_URL` | `https://api.testnet.blocky402.com` |
| `X402_PAY_TO_ACCOUNT_ID` | receiving account (`0.0.x`) |
| `X402_ASSET_ID` | `0.0.0` for HBAR, or an HTS token id |
| `X402_ASSET_DECIMALS` | `8` for HBAR, `6` for a 6-decimal token |
| `X402_HBAR_USD_PRICE` | e.g. `0.05` (only used when the asset is HBAR) |
| `X402_MARGIN` | `0.1` |
| `SESSION_JWT_SECRET` | 32+ random chars (`openssl rand -hex 32`) |
| `HARNESS_SECRET` | 32+ random chars |
| `HCS_AUDIT_TOPIC_ID` | public HCS topic (optional) |
| `HCS_AUDIT_OPERATOR_ID` | account that submits audit records |
| `HCS_AUDIT_OPERATOR_KEY` | its private key (secret) |
| `CORS_ORIGINS` | `http://localhost:3000` (add the Vercel domain after step 3) |
| `LOG_LEVEL` | `info` |

Deploy, then confirm:

```
curl https://<railway-domain>/health
curl https://<railway-domain>/v1/models
```

## 3. Vercel (web)

Import your fork. Set **Root Directory = `apps/web`** and enable *Include source
files outside of the Root Directory*.

Variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | `https://<railway-domain>` |
| `NEXT_PUBLIC_X402_NETWORK` | `hedera:testnet` |
| `NEXT_PUBLIC_X402_ASSET` | same as the gateway's `X402_ASSET_ID` |
| `NEXT_PUBLIC_X402_ASSET_SYMBOL` | `HBAR` or the token symbol |
| `NEXT_PUBLIC_X402_ASSET_DECIMALS` | same as the gateway's decimals |
| `NEXT_PUBLIC_X402_ASSET_USD_PRICE` | `1` for a USD token, the HBAR price otherwise |

Deploy → note the Vercel domain.

## 4. Close the loop

Set the gateway's `CORS_ORIGINS` to include the Vercel domain and redeploy:

```
CORS_ORIGINS=https://<vercel-domain>,http://localhost:3000
```

Open the site, connect a testnet wallet, send a prompt. It should pay the
deployed gateway and settle on Hedera; the Live tab shows the settlements.

---

## Troubleshooting

- **Build skips devDependencies** (`prisma`, `typescript`) because
  `NODE_ENV=production` — the `Dockerfile` installs before setting it, so keep
  that order.
- **`prisma generate` fails at build** — it needs *a* `DATABASE_URL`; the
  Dockerfile passes a placeholder because `generate` never connects.
- **`bun install` logs one failed package** (`@react-native/debugger-frontend`)
  — an optional React Native peer; ignore it.
- **Frontend loads but chat/analytics error** — the gateway URL baked into the
  build is wrong, or the gateway's `CORS_ORIGINS` is missing the Vercel domain.
  Fix the variable and redeploy (the web needs a rebuild).
- **`db:push` didn't run** — if the host lacks `preDeployCommand`, run it once:
  `railway run bun run --filter @router402/gateway db:push`.
