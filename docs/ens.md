# ENSv2

Router402 uses ENSv2 (Sepolia beta) for two things, and deliberately nothing
else: **the model catalogue** and **sessions**. Both replace state that used to
live only in this repo or this database. There are no `.eth` names in the UI
for their own sake.

## Why these two

A Router402 session was already an owner, an expiry, a revocation flag and a
set of caps in a Postgres row. That is the same object an ENSv2
`PermissionedRegistry` entry is, with one difference: the registry's copy is
public, ordered, and checkable by someone who does not trust this gateway.

The model catalogue was a `const` array in `packages/shared/src/models.ts`.
Prices, the Hedera account that gets paid, and the endpoint that serves each
model were compile-time facts. As records on a name they are runtime facts, and
a name in the registry is all it takes to list an agent.

## The namespace

```
router402.eth                          ETHRegistry entry (you own it)
  └── subregistry → AgentRegistry      UserRegistry proxy
      ├── claude-opus-5.router402.eth  one name per agent, records = terms
      ├── gemini-3-1-pro.router402.eth
      └── keys.router402.eth           subregistry → SessionRegistry
          └── sabc123.keys.router402.eth   one name per session
```

Two registry proxies and two resolver proxies, all `UserRegistry` /
`PermissionedResolver` instances deployed through the Verifiable Factory. No
custom Solidity: a gateway-signed design only needs `register()`,
`unregister()` and `setText()` on contracts that already exist.

## Sessions

`POST /v1/sessions` registers a name alongside the database row:

| Property | How ENSv2 provides it |
| --- | --- |
| Expiring | The registry stores `expiry` and enforces it. An expired name stops resolving whatever this gateway's clock says. |
| Revocable | Revoking is `unregister()`. Reviving it means a fresh registration with a new token — visible as such, not a flag flipped back. |
| Non-transferable | The owner gets `ROLE_UNREGISTER` and nothing more. Without `ROLE_CAN_TRANSFER_ADMIN` the ERC-1155 token cannot move, so a session key cannot be sold or lent on. Without `ROLE_RENEW` it cannot extend its own life. |
| Published terms | The caps, the wallet, the settlement asset and network are text records on the name. |

Who owns the name matters. An ECDSA-backed Hedera account has an EVM alias
derived from the same key, so the caller can sign for that address on Sepolia:
the session name is registered to **them**, and `ROLE_UNREGISTER` means they can
burn the session without the gateway's cooperation. ED25519 accounts have no
such address and fall back to the operator.

`requireSession` asks the registry whether the name is still live, cached for
15 seconds, and refuses the session when it is not. An unreachable Sepolia
returns "no opinion" and the database row stands on its own — a chain outage
must not lock every caller out of a gateway that settles on Hedera.

### What this does not give you

The gateway signs with one Sepolia key, because callers authenticate with
Hedera accounts that cannot sign an Ethereum transaction. That key holds the
root text role on the shared session resolver, so **it could rewrite a session's
cap records**. The caps are published and tamper-evident, not
cryptographically enforced.

What *is* enforced, by the registry rather than by trust: the expiry, the
revocation, and the non-transferability. Making the caps enforceable too means
the caller signing their own registration — an EVM wallet in the browser
alongside the Hedera one. That is a UX decision, not a missing feature.

## Agents

`bun run --cwd packages/ens ens:publish` writes each entry of `MODELS` out as a
name:

| Record | Meaning |
| --- | --- |
| `r402:model` | Canonical id, e.g. `anthropic/claude-opus-5` |
| `r402:upstream` | Id the provider API understands |
| `r402:provider` | `anthropic`, `google` |
| `r402:price:input` / `r402:price:output` | USD per 1M tokens |
| `r402:context` / `r402:max-output` | Token limits |
| `r402:reasoning` | Thinks before answering |
| `x402:pay-to` / `x402:network` / `x402:asset` | Settlement terms |
| `name` / `description` / `url` | Standard keys, so a generic ENS browser shows something |

The gateway reads this back at startup and every 60 seconds, and — this is the
part that matters — `priceRequest` quotes from it. A price change is a
transaction against a text record, not a redeploy. `GET /v1/models` reports
`source: "ens"` when the catalogue came from the registry and `"builtin"` when
it fell back.

Names are listed by replaying `LabelRegistered` logs and filtering by on-chain
status, so an expired or unregistered agent drops out on its own.

Two further ENSv2 features are wired up in `packages/ens/src/agents.ts`:

- `delegateAgentRecords` — `authorizeTextRoles` scopes a role to
  `keccak(node, keccak(key))`, so a provider can be handed control of its own
  `r402:price:input` without being able to touch `x402:pay-to` or any other
  name in the registry.
- `aliasAgent` — `setAlias` makes `opus.router402.eth` return
  `claude-opus-5.router402.eth`'s records with no second copy to keep in sync.
  Aliasing is only applied on the UniversalResolver path, which is why
  `readTexts` never calls a resolver directly.

## Setup

You need a Sepolia key with some ETH, and a `.eth` name registered to that key
on the ENSv2 Sepolia beta.

The beta has its own app — **[app.ens.dev](https://app.ens.dev)**, with
[explorer.ens.dev](https://explorer.ens.dev) for inspecting names afterwards.
Not the main ENS app. Registration is priced in USD but paid in a **test**
stablecoin on Sepolia whose `mint` is open to anyone, so a name costs nothing
real:

```bash
# Sepolia ETH for gas comes from a faucet; the stablecoin you mint yourself.
bun run --cwd packages/ens ens:mint-usdc 100
```

Then register at app.ens.dev with the same address as
`ENS_OPERATOR_PRIVATE_KEY`. One year is plenty.

Two things the beta will do to you: names and state are **reset periodically**
when the contracts are redeployed, and old deployments are left running rather
than torn down. If resolution suddenly returns nothing, re-check
`src/addresses.ts` against the docs table *and* against recent on-chain
`LabelRegistered` activity — bytecode at an address proves only that a
deployment once happened there.

```bash
# 1. Point at the chain and name you own.
ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENS_PARENT_NAME=router402.eth
ENS_OPERATOR_PRIVATE_KEY=0x…

# 2. Deploy the two registries and two resolvers, and wire the hierarchy.
#    Prints the env block to paste into .env.
bun run --cwd packages/ens ens:deploy

# 3. Publish the catalogue.
bun run --cwd packages/ens ens:publish

# 4. Apply the two new session columns, then start.
bun run db:push
bun run dev
```

`GET /v1/models` should now report `"source": "ens"`, and opening a session
should log `session registered on ENS` with the name and the transaction.

Leaving the `ENS_*` variables unset is supported: the gateway serves the
built-in catalogue and keeps sessions in Postgres only.

## Contract addresses

Pinned in `packages/ens/src/addresses.ts`, from the [ENS deployments
table](https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta) as of
2026-09-13. ENSv2 is documented as **not final** before mainnet — if a call
starts reverting, check those addresses and the interfaces in
`packages/ens/src/abi.ts` against `ensdomains/contracts-v2` before debugging
anything here.
