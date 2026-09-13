import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type RoutesConfig,
} from "@x402/core/server";
import type { HTTPRequestContext } from "@x402/core/server";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
} from "@x402/core/types";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { currentContext } from "./context.js";
import { env } from "./env.js";
import { recordSettlement } from "./ledger.js";
import { logger } from "./logger.js";
import { priceRequest } from "./quote.js";

const network = env.X402_NETWORK as Network;

const facilitator = new HTTPFacilitatorClient({
  url: env.X402_FACILITATOR_URL,
  timeoutMs: 30_000,
});

/**
 * Hedera ships only the `exact` scheme today, which settles the quoted amount
 * in full — there is no partial settlement to trim a charge down to actual
 * usage. Router402 therefore quotes an authorised budget up front (see
 * `quoteRequest`) and caps the upstream call to match it.
 */
const resourceServer = new x402ResourceServer(facilitator)
  .register(network, new ExactHederaScheme())
  .onAfterSettle(async ({ result, requirements }) => {
    const context = currentContext();
    if (!context) return;

    context.settlement = {
      transactionId: result.transaction || null,
      payer: result.payer ?? null,
      // `exact` settles the authorised amount; `amount` is only populated by
      // schemes that settle less, so fall back to the requirement.
      amountAtomic: BigInt(result.amount ?? requirements.amount),
      asset: requirements.asset,
      network: requirements.network,
      success: result.success,
      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    };

    await recordSettlement(context);
  })
  .onSettleFailure(async ({ requirements }) => {
    const context = currentContext();
    if (!context) return;

    context.settlement = {
      transactionId: null,
      payer: null,
      amountAtomic: BigInt(requirements.amount),
      asset: requirements.asset,
      network: requirements.network,
      success: false,
      errorMessage: "Facilitator failed to settle the payment",
    };

    await recordSettlement(context);
  });

/** Prices a chat request from the model and prompt it carries. */
const dynamicPrice = async (context: HTTPRequestContext) => {
  const priced = await priceRequest(context.adapter.getBody?.());

  const requestContext = currentContext();
  if (requestContext) requestContext.priced = priced;

  return {
    asset: env.X402_ASSET_ID,
    amount: priced.quote.amountAtomic.toString(),
  };
};

/** What an unpaid caller gets back alongside the 402 challenge. */
const quotePreview = async (context: HTTPRequestContext) => {
  const priced = await priceRequest(context.adapter.getBody?.());
  return {
    contentType: "application/json",
    body: {
      error: {
        type: "payment_required",
        message:
          "This request needs an x402 payment. Sign the attached requirements and retry with an X-PAYMENT header.",
      },
      quote: {
        model: priced.model.id,
        provider: priced.model.provider,
        input_tokens: priced.quote.inputTokens,
        authorized_output_tokens: priced.quote.maxOutputTokens,
        authorized_answer_tokens: priced.quote.visibleOutputTokens,
        authorized_thinking_tokens: priced.quote.thinkingTokens,
        amount_usd: priced.quote.amountUsd,
        amount_atomic: priced.quote.amountAtomic.toString(),
        asset: env.X402_ASSET_ID,
        network,
      },
    },
  };
};

const paymentOption = {
  scheme: "exact",
  network,
  payTo: env.X402_PAY_TO_ACCOUNT_ID,
  maxTimeoutSeconds: 120,
  price: dynamicPrice,
};

const routes: RoutesConfig = {
  "POST /v1/chat/completions": {
    description:
      "OpenRouter-compatible chat completion, billed per call in USDC on Hedera",
    mimeType: "application/json",
    serviceName: "Router402",
    tags: ["ai", "inference", "llm"],
    accepts: [paymentOption],
    unpaidResponseBody: quotePreview,
  },
  // Pays for a completion and returns a one-time delivery ticket; the tokens
  // themselves come back over GET /v1/chat/stream/:token, which is already
  // paid for and therefore ungated.
  "POST /v1/chat/stream": {
    description: "Pay for a streamed chat completion and receive a delivery token",
    mimeType: "application/json",
    serviceName: "Router402",
    tags: ["ai", "inference", "llm", "streaming"],
    accepts: [paymentOption],
    unpaidResponseBody: quotePreview,
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);

export const paymentMiddleware = paymentMiddlewareFromHTTPServer(httpServer);

export async function initializeX402(): Promise<void> {
  await httpServer.initialize();
  logger.info(
    { network, facilitator: env.X402_FACILITATOR_URL, payTo: env.X402_PAY_TO_ACCOUNT_ID },
    "x402 resource server ready",
  );
}

export const x402Config = {
  network,
  asset: env.X402_ASSET_ID,
  payTo: env.X402_PAY_TO_ACCOUNT_ID,
  facilitatorUrl: env.X402_FACILITATOR_URL,
  scheme: "exact" as const,
};

/** The facilitator's Hedera fee payer, learned when the server initializes. */
export function hederaFeePayer(): string | undefined {
  const kind = resourceServer.getSupportedKind(2, network, "exact");
  return (kind?.extra as { feePayer?: string } | undefined)?.feePayer;
}

/**
 * Build the `PAYMENT-SIGNATURE` a harness would have produced.
 *
 * A harness cannot sign, so the gateway signs on the wallet's behalf: it prices
 * the exact body the middleware will price, builds the Hedera transfer with the
 * wallet key, and returns the encoded payload. Injecting this header lets the
 * existing x402 middleware verify and settle it unchanged.
 */
export async function createHarnessPaymentHeader(
  body: unknown,
  payerAccountId: string,
  privateKeyDer: string,
): Promise<string> {
  const priced = await priceRequest(body);
  const feePayer = hederaFeePayer();

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network,
    amount: priced.quote.amountAtomic.toString(),
    asset: env.X402_ASSET_ID,
    payTo: env.X402_PAY_TO_ACCOUNT_ID,
    maxTimeoutSeconds: 120,
    extra: feePayer ? { feePayer } : {},
  };

  const key = PrivateKey.fromStringDer(privateKeyDer.trim().replace(/^0x/, ""));
  const signer = createClientHederaSigner(payerAccountId, key, { network });
  const transaction = await signer.createPartiallySignedTransferTransaction(
    requirements,
  );

  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction },
  };

  return encodePaymentSignatureHeader(payload);
}
