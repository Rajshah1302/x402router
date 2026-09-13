# Router402 — demo runbook

An x402-gated AI inference gateway on Hedera. An agent (opencode, Cursor, any
OpenAI-compatible tool) pays for every model call itself — in HBAR or an HTS
token — with **no API key and no subscription**. Each settlement is audited to
Hedera Consensus Service and discoverable by other agents.

Built for the **Hedera — AI & Agentic Payments** bounty.

---

## Architecture

```
opencode / any agent
        │  OpenAI-compatible, dummy API key
        ▼
┌───────────────────────────────┐
│  Router402 gateway (:4021)    │
│  • /v1/chat/completions (x402)│
│  • /h/<token>/v1/... harness  │──▶ DeepSeek (the model behind the label)
│  • /v1/discovery, agent card  │
│  • HCS audit publisher        │
└──────────────┬────────────────┘
               │ x402 `exact`
               ▼
   Blocky402 facilitator ──▶ Hedera (HBAR / HTS) ──▶ pay-to account
               │
               └──▶ HCS topic (ordered audit records)
```

The catalogue advertises Claude/Gemini models and pricing; the tokens are
produced by DeepSeek. Nothing in the quote, ledger or analytics path knows the
difference.

---

## What runs on Hedera

| Piece | Where |
|---|---|
| Payments | x402 `exact` scheme, settled by the **Blocky402** facilitator on `hedera:testnet` |
| Settlement asset | HBAR (`0.0.0`) or any **HTS** token; the demo uses a token with a **0.5% custom fee** |
| Audit trail | Every settlement is published to a public **HCS** topic |
| Identity | The wallet's Hedera account id is the identity; sessions are signed authorizations |

---

## Prerequisites

- Node 20+, **Bun** 1.3+
- A Postgres database (local Docker or Neon)
- A Hedera **testnet** account with HBAR (https://portal.hedera.com)
- A DeepSeek API key (or real Anthropic/Gemini keys)

---

## Setup

```bash
bun install
cp .env.example .env          # then fill in the values below
bun run db:push
bun run build                 # packages/shared must be built before the apps
```

Minimum `.env`:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres/Neon connection string |
| `DEEPSEEK_API_KEY` | your DeepSeek key |
| `X402_PAY_TO_ACCOUNT_ID` | Hedera account that receives payments |
| `SESSION_JWT_SECRET` | 32+ chars (`openssl rand -hex 32`) |

Optional, for the full demo:

```bash
# 1. Public HCS audit topic (operator = the account that submits records)
bun run scripts/create-audit-topic.ts <operatorAccountId> <operatorPrivateKey>
#   -> HCS_AUDIT_TOPIC_ID / HCS_AUDIT_OPERATOR_ID / HCS_AUDIT_OPERATOR_KEY

# 2. HTS settlement token with a 0.5% fee to a distinct treasury
bun run scripts/create-demo-token.ts <payerAccountId> <payerKeyFile>
#   -> X402_ASSET_ID / X402_ASSET_DECIMALS / X402_PAY_TO_ACCOUNT_ID
#   -> NEXT_PUBLIC_X402_ASSET* (must match on the web)
```

Run it:

```bash
bun run dev        # gateway :4021, web :3000
```

---

## Connecting an agent (opencode)

In the web app: **Settings → Harness access → Generate access URL**. That gives
a URL like `http://localhost:4021/h/<token>/v1` plus a ready opencode config.
Paste it into `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "router402": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Router402",
      "options": { "baseURL": "http://localhost:4021/h/<token>/v1", "apiKey": "x402" },
      "models": {
        "anthropic/claude-sonnet-5": { "name": "Claude Sonnet 5", "cost": { "input": 2.2, "output": 11 } }
      }
    }
  }
}
```

Then run `/models`, pick a Router402 model, and prompt. opencode shows an
estimated cost per message; the gateway terminal and the **Live** tab show the
HBAR/HTS actually moving on-chain.

The harness holds the wallet key (encrypted) so it can sign x402 on the agent's
behalf — **testnet only**, bounded by the session caps, revocable instantly.

---

## The payment flow

1. Agent calls `POST /v1/chat/completions`.
2. Gateway returns **402** with the requirements in the `PAYMENT-REQUIRED` header
   (scheme, network, asset, amount, pay-to, fee payer) and a quote breakdown.
3. The harness signs a Hedera transfer and retries with `PAYMENT-SIGNATURE`.
4. The facilitator verifies and **settles on Hedera**; the response carries
   `PAYMENT-RESPONSE` with the transaction id.
5. The gateway publishes the settlement to **HCS** and returns the completion.

Streaming is split: `POST /v1/chat/stream` pays and returns a one-time ticket;
`GET /v1/chat/stream/:token` streams the tokens already paid for.

---

## Demo script (≈5 minutes)

| Time | Beat | Proves |
|---|---|---|
| 0:00 | Show the opencode config: localhost URL, dummy key, no provider key | No API keys |
| 0:30 | HashScan: wallet balance before | Real on-chain identity |
| 0:45 | Run opencode on a real task; cut to **Live** + gateway terminal as `✓ paid …` lines stream in; open one tx on HashScan | Pay-per-call inference settled via Blocky402 |
| 2:00 | Open the **HCS topic** on HashScan: ordered records with model, amount, tx id, hashes | Verifiable payment audit trail |
| 3:00 | Revoke the harness token (or hit the cap); next request returns **402** and the agent stops | Programmable spend control |
| 3:45 | Show `GET /v1/discovery` and `/.well-known/agent.json` | Agent discovery |
| 4:15 | Switch to the HTS token: show the 0.5% fee credited to the treasury on HashScan | HTS + custom fee schedule |
| 4:45 | Wallet balance dropped by exactly the total; every row links to its tx | End to end |

---

## Verify it yourself

```bash
curl http://localhost:4021/v1/models          # catalogue + x402 terms + audit topic
curl http://localhost:4021/v1/discovery       # machine-readable directory
curl http://localhost:4021/.well-known/agent.json
curl http://localhost:4021/v1/audit           # { enabled, topicId, hashscanUrl }

# HCS records (base64 messages):
curl https://testnet.mirrornode.hedera.com/api/v1/topics/<topicId>/messages
```

---

## Bounty mapping

- ✅ Live x402-gated service on Hedera testnet, settled via the **Blocky402** facilitator
- ✅ A consuming agent (opencode) completing real paid requests
- ✅ **Pay-per-call inference metering** (tokens × model rate + margin)
- ✅ **Verifiable payment audit trail on HCS**
- ✅ **HTS token with a custom fee schedule** in the settlement path
- ✅ **Agent discovery** (x402 Bazaar, `/.well-known/agent.json`, `/v1/discovery`)
- ➖ Not covered: ERC-8004/HCS-14 on-chain agent identity, A2A negotiation,
  scheduled/streamed payments

---

## Known gaps

- **Custodial harness key.** The harness stores the wallet key (encrypted) to
  sign for an agent that cannot. A distinct session key authorized on-chain, or
  a Ledger-secured signer, would remove this.
- **`exact` settles the authorized budget**, not actual usage — unused output
  budget is not refunded. `upto` would fix it.
- **Reasoning models need headroom.** With a very small `max_tokens` a model can
  spend the whole budget thinking and return an empty answer.
- **Prices are a checked-in table** (`packages/shared/src/models.ts`), not fetched live.
- **Delivery tickets are in-process**, so the streaming path does not survive a restart.
