import { randomUUID } from "node:crypto";
import { atomicToUsd, type ChatCompletionResponse, type RequestSettlement } from "@router402/shared";
import type { RequestContext } from "./context.js";
import { env } from "./env.js";
import {
  closeInferenceRequest,
  failInferenceRequest,
  openInferenceRequest,
} from "./ledger.js";
import { providerFor } from "./providers/index.js";
import type { CompletionResult } from "./providers/types.js";
import type { PricedRequest } from "./quote.js";

export function settlementOf(
  context: RequestContext,
  priced: PricedRequest,
  actualOutputTokens: number,
): RequestSettlement {
  return {
    amountAtomic: priced.quote.amountAtomic.toString(),
    amountUsd: atomicToUsd(priced.quote.amountAtomic),
    authorizedOutputTokens: priced.quote.maxOutputTokens,
    actualOutputTokens,
    network: env.X402_NETWORK,
    asset: env.X402_ASSET_ID,
    // Settlement runs after the handler returns, so a request that is still
    // being served has no transaction id yet. GET /v1/requests/:id has it once
    // the facilitator confirms.
    transactionId: context.settlement?.transactionId ?? null,
    payer: context.settlement?.payer ?? null,
  };
}

export function toChatCompletionResponse(
  id: string,
  priced: PricedRequest,
  result: CompletionResult,
  settlement: RequestSettlement,
): ChatCompletionResponse {
  return {
    id: `chatcmpl_${id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: priced.model.id,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: result.finishReason,
      },
    ],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
    x402: settlement,
  };
}

/** Run a paid request to completion, recording usage on both outcomes. */
export async function runCompletion(
  context: RequestContext,
  priced: PricedRequest,
  streamed = false,
): Promise<{ requestId: string; result: CompletionResult }> {
  const requestId = await openInferenceRequest({
    context,
    model: priced.model,
    inputTokens: priced.quote.inputTokens,
    authorizedOutputTokens: priced.quote.maxOutputTokens,
    amountAtomic: priced.quote.amountAtomic,
    streamed,
  });

  const startedAt = Date.now();

  try {
    const result = await providerFor(priced.model.provider).complete({
      model: priced.model,
      messages: priced.messages,
      maxOutputTokens: priced.quote.maxOutputTokens,
      thinkingTokens: priced.quote.thinkingTokens,
      temperature: priced.temperature,
    });

    await closeInferenceRequest({
      id: requestId,
      model: priced.model,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    });

    return { requestId, result };
  } catch (error) {
    await failInferenceRequest(
      requestId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * A paid-for completion waiting to be streamed.
 *
 * The x402 middleware buffers a protected response until settlement finishes,
 * so tokens cannot reach the browser live through it. Payment and delivery are
 * therefore split: the protected endpoint settles and hands back a one-time
 * ticket, and an unprotected endpoint streams against that ticket.
 */
export interface DeliveryTicket {
  token: string;
  context: RequestContext;
  priced: PricedRequest;
  expiresAt: number;
  claimed: boolean;
}

const TICKET_TTL_MS = 2 * 60_000;
const tickets = new Map<string, DeliveryTicket>();

export function issueDeliveryTicket(
  context: RequestContext,
  priced: PricedRequest,
): DeliveryTicket {
  sweepTickets();

  const ticket: DeliveryTicket = {
    token: randomUUID(),
    context,
    priced,
    expiresAt: Date.now() + TICKET_TTL_MS,
    claimed: false,
  };

  tickets.set(ticket.token, ticket);
  return ticket;
}

/** Tickets are single-use: claiming one removes it. */
export function claimDeliveryTicket(token: string): DeliveryTicket | undefined {
  sweepTickets();

  const ticket = tickets.get(token);
  if (!ticket || ticket.claimed) return undefined;

  ticket.claimed = true;
  tickets.delete(token);
  return ticket;
}

function sweepTickets(): void {
  const now = Date.now();
  for (const [token, ticket] of tickets) {
    if (ticket.expiresAt < now) tickets.delete(token);
  }
}
