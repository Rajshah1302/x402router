import { issueSessionToken } from "./src/auth/session.js";
import { prisma } from "./src/db.js";

const WALLET = "0.0.999999";

const account = await prisma.account.upsert({
  where: { walletAddress: WALLET },
  create: { walletAddress: WALLET, network: "hedera:testnet" },
  update: {},
});

const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
const session = await prisma.session.create({
  data: {
    accountId: account.id,
    sessionAccountId: WALLET,
    sessionPublicKey: "00",
    network: "hedera:testnet",
    spendCapAtomic: 5_000_000n,
    perRequestCapAtomic: 250_000n,
    expiresAt,
  },
});

const token = await issueSessionToken(
  { sessionId: session.id, accountId: account.id, walletAddress: WALLET },
  expiresAt,
);

const res = await fetch("http://localhost:4021/v1/chat/stream", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Origin: "http://localhost:3000",
  },
  body: JSON.stringify({
    model: "anthropic/claude-opus-5",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 64,
  }),
});

console.log("status:", res.status);
console.log("expose-headers:", res.headers.get("access-control-expose-headers"));
console.log("payment-required:", res.headers.get("payment-required") ? "PRESENT" : "MISSING");
console.log("body:", (await res.text()).slice(0, 300));

await prisma.session.delete({ where: { id: session.id } });
await prisma.account.delete({ where: { id: account.id } });
await prisma.$disconnect();
