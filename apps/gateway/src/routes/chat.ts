import { Router } from "express";
import { assetAtomicToUsd, type ChatCompletionChunk } from "@router402/shared";
import { currentContext } from "../context.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  claimDeliveryTicket,
  issueDeliveryTicket,
  runCompletion,
  settlementOf,
  toChatCompletionResponse,
} from "../inference.js";
import {
  closeInferenceRequest,
  failInferenceRequest,
  linkPaymentToRequest,
  openInferenceRequest,
} from "../ledger.js";
import { logger } from "../logger.js";
import { HttpError } from "../middleware/error.js";
import { providerFor } from "../providers/index.js";
import { priceRequest, type PricedRequest } from "../quote.js";

export const chatRouter: Router = Router();

/** Reject a request the session is not allowed to spend this much on. */
function enforcePerRequestCap(
  priced: PricedRequest,
  perRequestCapAtomic: bigint,
): void {
  if (priced.quote.amountAtomic > perRequestCapAtomic) {
    const cost = priced.quote.amountUsd.toFixed(6);
    const cap = assetAtomicToUsd(
      perRequestCapAtomic,
      env.paymentAsset,
    ).toFixed(6);
    throw new HttpError(
      402,
      `This request costs $${cost}, above the session per-request cap of $${cap}. Lower max_tokens, or open a session with a higher cap.`,
      "cap_exceeded",
    );
  }
}

function context() {
  const ctx = currentContext();
  if (!ctx) throw new HttpError(500, "Request context was lost");
  return ctx;
}

/**
 * OpenRouter-compatible chat completion. x402 payment is enforced by the
 * middleware mounted ahead of this handler.
 *
 * `stream: true` is accepted and answered as SSE, but the payment middleware
 * buffers a protected response until settlement completes, so the events all
 * arrive at once. Use POST /v1/chat/stream for token-by-token delivery.
 */
chatRouter.post("/v1/chat/completions", async (req, res, next) => {
    try {
      const ctx = context();
      const priced = await priceRequest(req.body);
      enforcePerRequestCap(priced, req.session!.perRequestCapAtomic);

      const { requestId, result } = await runCompletion(ctx, priced);
      const settlement = settlementOf(ctx, priced, result.usage.outputTokens);

      if (!priced.stream) {
        res.json(
          toChatCompletionResponse(requestId, priced, result, settlement),
        );
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");

      const base = {
        id: `chatcmpl_${requestId}`,
        object: "chat.completion.chunk" as const,
        created: Math.floor(Date.now() / 1000),
        model: priced.model.id,
      };

      const chunks: ChatCompletionChunk[] = [
        {
          ...base,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: result.text },
              finish_reason: null,
            },
          ],
        },
        {
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: result.finishReason }],
          usage: {
            prompt_tokens: result.usage.inputTokens,
            completion_tokens: result.usage.outputTokens,
            total_tokens: result.usage.inputTokens + result.usage.outputTokens,
          },
          x402: settlement,
        },
      ];

      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Pay now, stream in a moment.
 *
 * This endpoint sits behind the same x402 middleware, but its response is tiny
 * — a one-time ticket — so the middleware's buffering costs nothing. The caller
 * then opens GET /v1/chat/stream/:token, which is not payment-gated because the
 * payment already settled here, and receives live tokens.
 */
chatRouter.post("/v1/chat/stream", async (req, res, next) => {
  try {
    const ctx = context();
    const priced = await priceRequest(req.body);
    enforcePerRequestCap(priced, req.session!.perRequestCapAtomic);

    const ticket = issueDeliveryTicket(ctx, priced);

    res.status(201).json({
      delivery_token: ticket.token,
      expires_at: new Date(ticket.expiresAt).toISOString(),
      model: priced.model.id,
      quote: {
        input_tokens: priced.quote.inputTokens,
        authorized_output_tokens: priced.quote.maxOutputTokens,
        amount_usd: priced.quote.amountUsd,
        amount_atomic: priced.quote.amountAtomic.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

chatRouter.get("/v1/chat/stream/:token", async (req, res, next) => {
  const ticket = claimDeliveryTicket(req.params.token);

  if (!ticket) {
    next(
      new HttpError(
        404,
        "Unknown, already used, or expired delivery token. Pay again at POST /v1/chat/stream.",
      ),
    );
    return;
  }

  const { priced, context: ctx } = ticket;
  const startedAt = Date.now();

  const requestId = await openInferenceRequest({
    context: ctx,
    model: priced.model,
    inputTokens: priced.quote.inputTokens,
    authorizedOutputTokens: priced.quote.maxOutputTokens,
    amountAtomic: priced.quote.amountAtomic,
    streamed: true,
  });

  // The payment settled on the POST, before this row existed; link it now so
  // GET /v1/requests/:id can surface the Hedera transaction id.
  await linkPaymentToRequest(ctx.paymentId, requestId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const base = {
    id: `chatcmpl_${requestId}`,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model: priced.model.id,
  };

  const send = (chunk: ChatCompletionChunk) =>
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);

  try {
    const stream = providerFor(priced.model.provider).stream({
      model: priced.model,
      messages: priced.messages,
      maxOutputTokens: priced.quote.maxOutputTokens,
      thinkingTokens: priced.quote.thinkingTokens,
      temperature: priced.temperature,
    });

    for await (const chunk of stream) {
      if (chunk.type === "delta") {
        send({
          ...base,
          choices: [
            { index: 0, delta: { content: chunk.text }, finish_reason: null },
          ],
        });
        continue;
      }

      await closeInferenceRequest({
        id: requestId,
        model: priced.model,
        usage: chunk.result.usage,
        latencyMs: Date.now() - startedAt,
      });

      send({
        ...base,
        choices: [
          { index: 0, delta: {}, finish_reason: chunk.result.finishReason },
        ],
        usage: {
          prompt_tokens: chunk.result.usage.inputTokens,
          completion_tokens: chunk.result.usage.outputTokens,
          total_tokens:
            chunk.result.usage.inputTokens + chunk.result.usage.outputTokens,
        },
        x402: settlementOf(ctx, priced, chunk.result.usage.outputTokens),
      });
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, requestId }, "Streaming delivery failed");
    await failInferenceRequest(requestId, message);

    // Headers are already out, so the failure has to travel in the stream.
    const payload = {
      error: { type: "provider_error", message, request_id: requestId },
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

/** Settlement details for one request, including the Hedera transaction id. */
chatRouter.get("/v1/requests/:id", async (req, res, next) => {
  try {
    const row = await prisma.inferenceRequest.findFirst({
      where: { id: req.params.id, accountId: req.session!.accountId },
      include: { payment: true },
    });

    if (!row) {
      throw new HttpError(404, "No such request for this wallet");
    }

    res.json({
      id: row.id,
      model: row.model,
      provider: row.provider,
      status: row.status.toLowerCase(),
      created_at: row.createdAt.toISOString(),
      completed_at: row.completedAt?.toISOString() ?? null,
      latency_ms: row.latencyMs,
      usage: {
        prompt_tokens: row.inputTokens,
        completion_tokens: row.outputTokens,
        authorized_output_tokens: row.authorizedOutputTokens,
      },
      x402: {
        amount_atomic: row.amountAtomic.toString(),
        amount_usd: assetAtomicToUsd(row.amountAtomic, env.paymentAsset),
        transaction_id: row.payment?.transactionId ?? null,
        payer: row.payment?.payer ?? null,
        status: row.payment?.status.toLowerCase() ?? "pending",
      },
    });
  } catch (error) {
    next(error);
  }
});
