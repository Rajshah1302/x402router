import { providerCostUsd, type ModelSpec } from "@router402/shared";
import type { RequestContext } from "./context.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { printSettlement } from "./payment-feed.js";
import type { CompletionUsage } from "./providers/types.js";

/** Open the inference row before the provider is called. */
export async function openInferenceRequest(params: {
  context: RequestContext;
  model: ModelSpec;
  inputTokens: number;
  authorizedOutputTokens: number;
  amountAtomic: bigint;
  streamed: boolean;
}): Promise<string> {
  const row = await prisma.inferenceRequest.create({
    data: {
      accountId: params.context.accountId,
      sessionId: params.context.sessionId,
      model: params.model.id,
      provider: params.model.provider,
      streamed: params.streamed,
      inputTokens: params.inputTokens,
      authorizedOutputTokens: params.authorizedOutputTokens,
      amountAtomic: params.amountAtomic,
    },
    select: { id: true },
  });

  params.context.inferenceRequestId = row.id;
  return row.id;
}

export async function closeInferenceRequest(params: {
  id: string;
  model: ModelSpec;
  usage: CompletionUsage;
  latencyMs: number;
}): Promise<void> {
  await prisma.inferenceRequest.update({
    where: { id: params.id },
    data: {
      outputTokens: params.usage.outputTokens,
      inputTokens: params.usage.inputTokens,
      providerCostMicroUsd: Math.round(
        providerCostUsd(params.model, params.usage) * 1_000_000,
      ),
      status: "SETTLED",
      latencyMs: params.latencyMs,
      completedAt: new Date(),
    },
  });
}

export async function failInferenceRequest(
  id: string,
  message: string,
): Promise<void> {
  await prisma.inferenceRequest
    .update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: message.slice(0, 500),
        completedAt: new Date(),
      },
    })
    .catch((error) => logger.error({ err: error, id }, "Failed to mark inference request failed"));
}

/**
 * Write the settlement to the ledger and move the session's spend counter.
 * Called from the x402 settle hooks, after the handler has produced a response.
 */
export async function recordSettlement(context: RequestContext): Promise<void> {
  const settlement = context.settlement;
  if (!settlement) return;

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          accountId: context.accountId,
          sessionId: context.sessionId,
          inferenceRequestId: context.inferenceRequestId ?? null,
          amountAtomic: settlement.amountAtomic,
          asset: settlement.asset,
          network: settlement.network,
          payer: settlement.payer,
          payTo: env.X402_PAY_TO_ACCOUNT_ID,
          transactionId: settlement.transactionId,
          status: settlement.success ? "SETTLED" : "FAILED",
          errorMessage: settlement.errorMessage ?? null,
          settledAt: settlement.success ? new Date() : null,
        },
        select: { id: true },
      });

      if (settlement.success) {
        await tx.session.update({
          where: { id: context.sessionId },
          data: { spentAtomic: { increment: settlement.amountAtomic } },
        });
      }

      return payment.id;
    });

    context.paymentId = paymentId;

    printSettlement({
      success: settlement.success,
      transactionId: settlement.transactionId,
      payer: settlement.payer,
      amountAtomic: settlement.amountAtomic,
      model: context.priced?.model.id,
    });
  } catch (error) {
    // The payment is already on-chain; losing the ledger row must not fail the
    // caller's request, but it does need to be loud.
    logger.error(
      { err: error, sessionId: context.sessionId, tx: settlement.transactionId },
      "Settled payment could not be written to the ledger",
    );
  }
}

/**
 * Attach a settled payment to the inference row it paid for.
 *
 * On the streaming path the payment settles during `POST /v1/chat/stream`,
 * before the completion exists, so `Payment.inferenceRequestId` is written as
 * null. When the delivery ticket is later claimed and the inference row is
 * created, this closes the loop so `GET /v1/requests/:id` can find the
 * settlement.
 */
export async function linkPaymentToRequest(
  paymentId: string | undefined,
  inferenceRequestId: string,
): Promise<void> {
  if (!paymentId) return;
  try {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { inferenceRequestId },
    });
  } catch (error) {
    logger.error(
      { err: error, paymentId, inferenceRequestId },
      "Could not link payment to its inference request",
    );
  }
}
