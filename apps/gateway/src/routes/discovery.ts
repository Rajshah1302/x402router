import { Router } from "express";
import { auditInfo } from "../audit/hcs.js";
import { ensInfo } from "../ens.js";
import { env } from "../env.js";
import { x402Config } from "../x402.js";
import { serializedModels } from "./models.js";

/**
 * Discovery: how another agent finds and understands this service.
 *
 * `/.well-known/agent.json` is an A2A-style agent card; `/v1/discovery` is a
 * machine-readable directory of the paid endpoints, prices and payment terms.
 * Together with the x402 Bazaar listing, they make the service findable
 * without a human reading a README.
 */
export const discoveryRouter: Router = Router();

function baseUrl(req: {
  protocol: string;
  get(name: string): string | undefined;
}): string {
  return `${req.protocol}://${req.get("host") ?? `localhost:${env.PORT}`}`;
}

const SERVICE = {
  name: "Router402",
  description:
    "Pay-per-call AI inference, settled in HBAR on Hedera over x402. No API keys, no subscription.",
  version: "0.1.0",
};

discoveryRouter.get("/.well-known/agent.json", (req, res) => {
  const base = baseUrl(req);
  res.json({
    name: SERVICE.name,
    description: SERVICE.description,
    url: `${base}/v1`,
    version: SERVICE.version,
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    provider: { organization: SERVICE.name, url: base },
    skills: [
      {
        id: "chat-completion",
        name: "Chat completion",
        description:
          "OpenAI/OpenRouter-compatible chat completion, priced per call.",
        tags: ["ai", "inference", "llm", "x402"],
        examples: ["Explain the x402 payment flow in one paragraph."],
      },
      {
        id: "chat-stream",
        name: "Streaming chat completion",
        description: "Token-by-token streaming completion, paid per call.",
        tags: ["ai", "inference", "llm", "streaming", "x402"],
      },
    ],
    x402: { ...x402Config, audit: auditInfo() },
    ens: ensInfo(),
  });
});

discoveryRouter.get("/v1/discovery", (req, res) => {
  const base = baseUrl(req);
  res.json({
    service: { ...SERVICE, url: base },
    payment: { ...x402Config, audit: auditInfo() },
    // Where this gateway's agents and sessions live in the ENS namespace, so
    // a caller can resolve an agent's terms without trusting this response.
    ens: ensInfo(),
    endpoints: [
      {
        method: "GET",
        path: "/v1/models",
        paid: false,
        description: "Model catalogue and prices",
      },
      {
        method: "POST",
        path: "/v1/chat/completions",
        paid: true,
        description: "Chat completion",
      },
      {
        method: "POST",
        path: "/v1/chat/stream",
        paid: true,
        description: "Streaming chat completion",
      },
      {
        method: "GET",
        path: "/v1/audit",
        paid: false,
        description: "HCS settlement audit topic",
      },
    ],
    models: serializedModels(),
    discovery: {
      agentCard: `${base}/.well-known/agent.json`,
      directory: `${base}/v1/discovery`,
    },
  });
});

discoveryRouter.get("/v1/audit", (_req, res) => {
  const info = auditInfo();
  res.json({ enabled: Boolean(info), ...(info ?? {}) });
});
