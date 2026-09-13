import { Router } from "express";
import { assetAtomicToUsd, quoteRequest } from "@router402/shared";
import { auditInfo } from "../audit/hcs.js";
import {
  catalogueModels,
  catalogueSource,
  ensNameForModel,
} from "../catalogue.js";
import { ensInfo } from "../ens.js";
import { env } from "../env.js";
import { x402Config } from "../x402.js";

export const modelsRouter: Router = Router();

const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** The catalogue with Router402's own pricing attached, in the wire shape. */
export function serializedModels() {
  return catalogueModels().map((model) => ({
    id: model.id,
    object: "model",
    name: model.displayName,
    // Present only when the entry was resolved from ENS, so a client can tell
    // a published agent from one baked into this build.
    ens_name: ensNameForModel(model.id),
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
      currency: env.paymentAsset.symbol,
      // A worked example so a client can sanity-check the quote it gets.
      example_1k_prompt_256_completion_usd: assetAtomicToUsd(
        quoteRequest(model, 1000, 256, env.X402_MARGIN, env.paymentAsset)
          .amountAtomic,
        env.paymentAsset,
      ),
    },
  }));
}

/** OpenRouter-compatible model list, with Router402's own pricing attached. */
modelsRouter.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: serializedModels(),
    source: catalogueSource(),
    ens: ensInfo(),
    x402: { ...x402Config, audit: auditInfo() },
  });
});
