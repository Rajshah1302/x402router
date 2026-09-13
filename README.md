# Router402

An OpenRouter-compatible, pay-per-call AI inference gateway. Every request is
metered and settled in USDC on Hedera over [x402](https://docs.x402.org) — no
API keys, no subscription, no prepaid balance.

Connect a wallet → the wallet address is your identity → authorize a session
once → every inference request after that pays for itself.

```
Wallet ──▶ Session key ──▶ Router402 gateway ──▶ Claude / Gemini
                                │
                                └─▶ x402 ──▶ Blocky402 facilitator ──▶ Hedera
```

## Layout

```
apps/gateway      Express + Prisma gateway: routing, metering, pricing, x402
apps/web          Next.js chat, analytics and settings interface
packages/shared   Pricing maths, wire types, the catalogue seed
packages/ens      ENSv2 namespace: agent names and session names on Sepolia
```

Turborepo + Bun workspaces. Node 20+, Bun 1.3+.

## Running it

```bash
bun install
cp .env.example .env          # fill in the values below
bun run db:push               # push the schema to Neon/Postgres
bun run build                 # packages/shared must be built before the apps
bun run dev                   # gateway on :4021, web on :3000
```

### Configuration

| Variable                 | What it is                                                     |
| ------------------------ | -------------------------------------------------------------- |
| `DATABASE_URL`           | Neon/Postgres connection string                                |
| `ANTHROPIC_API_KEY`      | Upstream key for Claude models                                 |
| `GEMINI_API_KEY`         | Upstream key for Gemini models                                 |
| `X402_NETWORK`           | `hedera:testnet` or `hedera:mainnet`                           |
| `X402_FACILITATOR_URL`   | Blocky402, e.g. `https://api.testnet.blocky402.com`            |
| `X402_PAY_TO_ACCOUNT_ID` | Hedera account that receives payments                          |
| `X402_ASSET_ID`          | HTS asset callers pay in; defaults to USDC for the network     |
| `X402_MARGIN`            | Gateway margin over upstream cost (`0.1` = 10%)                |
| `SESSION_JWT_SECRET`     | Signs session tokens; `openssl rand -hex 32`                   |
| `ENS_*`                  | ENSv2 registries; optional, see [docs/ens.md](docs/ens.md)     |

A model that has no key configured returns `503` rather than failing at call
time; the rest of the catalogue keeps working.

## How payment works

### Sessions

The wallet signs **one** message naming the session key, a total spend cap, a
per-request cap and an expiry. The gateway verifies that signature against the
public key Hedera holds for the account (via the mirror node) and issues a
session token. The session **private key never reaches the gateway** — it signs
x402 payments in the browser.

Because the caps are part of the signed message, the gateway cannot widen them
afterwards. Revoking the session or hitting either cap stops it immediately.

```
POST /v1/sessions/nonce       → a fresh nonce
POST /v1/sessions/challenge   → the exact bytes to sign
POST /v1/sessions             → { token, session }
GET  /v1/sessions/current
POST /v1/sessions/current/revoke
```

### Names

Sessions and models are **ENSv2 names**, not rows and constants.

A session is registered in a `PermissionedRegistry` as
`sabc123.keys.router402.eth`: the registry holds the expiry and enforces it,
revoking is `unregister()` rather than a database flag only this gateway can
see, and the name is non-transferable because the owner is granted
`ROLE_UNREGISTER` and nothing else. Where the caller's Hedera account is
ECDSA-backed the name is registered to *their* EVM alias, so they can burn the
session without the gateway's help. `requireSession` treats the registry as the
authority on whether a session is still open.

The model catalogue is read off ENS at runtime — price, provider, upstream id,
the Hedera account that gets paid and the endpoint that serves it are text
records on `claude-opus-5.router402.eth` and friends. `priceRequest` quotes
from those records, so changing a price is a transaction, not a deploy, and a
third party can list an agent by registering a name. `GET /v1/models` reports
whether the catalogue came from ENS or fell back to the built-in seed.

The `ENS_*` variables are optional: leave them unset and the gateway serves the
built-in catalogue with database-only sessions. [docs/ens.md](docs/ens.md) has
the namespace layout, the setup runbook, and an honest account of what a
gateway-signed design does and does not enforce.

### Pricing

A request is priced **before it runs**: the prompt is token-counted upstream,
and the caller buys that prompt plus a bounded completion, at the model's
published rate plus the gateway margin. The upstream call is then capped at
exactly the authorized ceiling.

`max_tokens` means the **visible answer**, as it does everywhere else. On a
model that thinks before answering, thinking bills at the output rate, so the
quote adds a thinking allowance on top and the 402 challenge reports the split:

```
authorized_output_tokens:   256   ← what you pay for
authorized_answer_tokens:   128   ← what you asked for
authorized_thinking_tokens: 128   ← allowance so the answer isn't truncated
```

This is not cosmetic. Gemini's `maxOutputTokens` bounds total output but does
not reserve anything for the answer: set it alone and a reasoning model spends
the budget thinking and returns a stub — measured at 245 of 256 tokens thought,
7 answered, the reply cut off mid-word. Budgeting thinking explicitly is what
keeps the answer intact and the spend inside what was paid.

> **Why an authorized budget rather than actual usage?** Hedera currently ships
> only the x402 `exact` scheme, which settles the quoted amount in full — there
> is no partial settlement to trim a charge down to real consumption. Quoting a
> budget is the honest version of that constraint: you are never billed for
> tokens you did not authorize, and never surprised by an overage. Unused output
> budget is not refunded, so `max_tokens` is the spend dial. Analytics reports
> authorized against actual so the gap is visible.
>
> When `@x402/hedera` gains the `upto` scheme, `SettlementOverrides` lets the
> settlement be trimmed to actual usage with no change to the client contract.
> That swap is isolated to `packages/shared/src/pricing.ts` and `apps/gateway/src/x402.ts`.

### Endpoints

| Endpoint                        | Paid | Notes                                    |
| ------------------------------- | ---- | ---------------------------------------- |
| `GET  /v1/models`               | no   | OpenRouter-style catalogue with pricing  |
| `POST /v1/chat/completions`     | yes  | OpenRouter-compatible                    |
| `POST /v1/chat/stream`          | yes  | Pays, returns a one-time delivery ticket |
| `GET  /v1/chat/stream/:token`   | —    | Streams the completion already paid for  |
| `GET  /v1/requests/:id`         | no¹  | Settlement detail incl. Hedera tx id     |
| `GET  /v1/analytics`            | no¹  | Usage and spend for the connected wallet |

¹ Requires a session token, but costs nothing.

An unpaid call gets a `402` carrying the payment requirements *and* a quote
breakdown, so a client can decide before signing:

```json
{
  "error": { "type": "payment_required", "message": "…" },
  "quote": {
    "model": "anthropic/claude-sonnet-5",
    "input_tokens": 412,
    "authorized_output_tokens": 1024,
    "amount_usd": 0.012169,
    "asset": "0.0.429274",
    "network": "hedera:testnet"
  }
}
```

### Why streaming has two endpoints

The x402 Express middleware buffers a protected response until settlement
completes — it has to, because it hashes the response body into the settlement
and can cancel the payment if the handler fails. That is correct for payments
and fatal for server-sent events: nothing reaches the browser until the whole
answer is finished.

So payment and delivery are split. `POST /v1/chat/stream` is payment-gated but
returns only a small ticket, which costs nothing to buffer. `GET
/v1/chat/stream/:token` is ungated — the payment already settled — and streams
live. The ticket is single-use and expires in two minutes.

The trade-off is deliberate: on this path the payment settles before the tokens
are produced, so a provider failure after payment is recorded as a failed
request rather than automatically refunded. `POST /v1/chat/completions` keeps
the safer ordering (settle after the handler, cancel on failure) and is what
agents and SDKs should use.

## Data model

`Account` (one per wallet address) → `Session` → `InferenceRequest` ↔ `Payment`.

Amounts are stored as `BigInt` USDC atomic units and provider cost as integer
micro-dollars, so the ledger never carries floating-point drift. Analytics sums
what was actually charged rather than recomputing it from tokens, so the numbers
reconcile with on-chain settlements.

## The web app

- **Chat** — GPT-style, model selector, output-budget selector, live streaming,
  per-response cost and Hedera transaction id.
- **Analytics** — spend, requests, tokens, average cost, spend over time, and
  breakdowns by model and provider, plus recent requests and x402 settlements.
- **Settings** — wallet, session status and caps, revoke, model catalogue.

### Wallet connector

The MVP ships `LocalKeyWallet`: a Hedera key held in the browser, suitable for
testnet. A HashPack or WalletConnect connector only needs to implement the two
methods of the `Wallet` interface in `apps/web/lib/wallet.ts` — `accountId` and
`signMessage` — and nothing else changes.

## Known gaps

- **No refund path.** The `exact` scheme cannot settle a partial amount, so
  unused output budget stays spent. Revisit with `upto`.
- **Delivery tickets are in-process.** Streaming tickets live in gateway memory,
  so the streaming path does not survive a restart or run behind more than one
  instance. Move them to Redis or the database before scaling out.
- **Session key equals wallet key in the MVP.** Both already live in the same
  browser, so a distinct key would add ceremony without adding isolation. With
  an extension or hardware wallet, generate a fresh session key and have the
  wallet sign the authorization for it — `openSession` in
  `apps/web/lib/session-context.tsx` is the one place to change.
- **Prices are a checked-in table.** `packages/shared/src/models.ts` carries
  provider list prices as of 2026-09-13; they are not fetched live.
- **Gemini can overshoot its ceiling slightly.** `maxOutputTokens` is enforced
  approximately — 263 tokens returned against a 256 cap in testing. The caller
  is charged the quoted amount regardless, so the gateway absorbs the few
  percent. Widen the margin if that matters at volume.
- **`google/gemini-3.1-pro` needs a paid Google plan.** Its free-tier quota is
  zero, so it returns `429` until billing is enabled on the API key. The other
  Gemini models work on the free tier.
