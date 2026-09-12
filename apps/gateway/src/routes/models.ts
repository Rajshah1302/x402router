import { Router } from "express";
import { MODELS, atomicToUsd, quoteRequest } from "@router402/shared";
import { env } from "../env.js";
import { x402Config } from "../x402.js";

export const modelsRouter: Router = Router();

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** OpenRouter-compatible model list, with Router402's own pricing attached. */
modelsRouter.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: MODELS.map((model) => ({
      id: model.id,
      object: "model",
      name: model.displayName,
      provider: model.provider,
      context_length: model.contextWindow,
      max_output_tokens: model.maxOutputTokens,
      reasoning: model.reasoning,
      pricing: {
        // What the caller pays, margin included, per million tokens. Rounded
        // because the margin multiply otherwise leaks float noise into the API.
        prompt_usd_per_mtok: round(model.inputPricePerMTok * (1 + env.X402_MARGIN)),
        completion_usd_per_mtok: round(
          model.outputPricePerMTok * (1 + env.X402_MARGIN),
        ),
        currency: "USDC",
        // A worked example so a client can sanity-check the quote it gets.
        example_1k_prompt_256_completion_usd: atomicToUsd(
          quoteRequest(model, 1000, 256, env.X402_MARGIN).amountAtomic,
        ),
      },
    })),
    x402: x402Config,
  });
});
