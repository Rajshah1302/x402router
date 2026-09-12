import type {
  AnalyticsResponse,
  ChatMessage,
  SessionInfo,
} from "@router402/shared";
import { parsePrivateKey, type Wallet } from "./wallet";

export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4021";

export const NETWORK = process.env.NEXT_PUBLIC_X402_NETWORK ?? "hedera:testnet";

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function unwrap(response: Response): Promise<unknown> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } }).error?.message ??
      `Gateway returned ${response.status}`;
    throw new GatewayError(message, response.status);
  }

  return body;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  context_length: number;
  max_output_tokens: number;
  reasoning: boolean;
  pricing: {
    prompt_usd_per_mtok: number;
    completion_usd_per_mtok: number;
    currency: string;
    example_1k_prompt_256_completion_usd: number;
  };
}

export async function fetchModels(): Promise<ModelOption[]> {
  const body = (await unwrap(await fetch(`${GATEWAY_URL}/v1/models`))) as {
    data: ModelOption[];
  };
  return body.data;
}

export interface SessionTerms {
  spendCapUsd: number;
  perRequestCapUsd: number;
  ttlHours: number;
}

/**
 * Open a session.
 *
 * The wallet signs one authorization message naming the session key and its
 * limits; from then on the session key signs payments on its own. That single
 * signature is the whole of the "authorize once, not per request" promise.
 */
export async function createSession(
  wallet: Wallet,
  sessionPrivateKey: string,
  terms: SessionTerms,
): Promise<{ token: string; session: SessionInfo }> {
  const key = await parsePrivateKey(sessionPrivateKey);
  const sessionPublicKey = key.publicKey.toStringDer();

  const { nonce } = (await unwrap(
    await fetch(`${GATEWAY_URL}/v1/sessions/nonce`),
  )) as { nonce: string };

  const request = {
    walletAddress: wallet.accountId,
    sessionAccountId: wallet.accountId,
    sessionPublicKey,
    spendCapUsd: terms.spendCapUsd,
    perRequestCapUsd: terms.perRequestCapUsd,
    ttlHours: terms.ttlHours,
    nonce,
  };

  // Ask the gateway for the exact bytes to sign rather than rebuilding the
  // message here — one definition, no drift between client and server.
  const { message } = (await unwrap(
    await fetch(`${GATEWAY_URL}/v1/sessions/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  )) as { message: string };

  const signature = await wallet.signMessage(message);

  return (await unwrap(
    await fetch(`${GATEWAY_URL}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, signature }),
    }),
  )) as { token: string; session: SessionInfo };
}

export async function fetchCurrentSession(token: string): Promise<SessionInfo> {
  const body = (await unwrap(
    await fetch(`${GATEWAY_URL}/v1/sessions/current`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  )) as { session: SessionInfo };
  return body.session;
}

export async function revokeSession(token: string): Promise<SessionInfo> {
  const body = (await unwrap(
    await fetch(`${GATEWAY_URL}/v1/sessions/current/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  )) as { session: SessionInfo };
  return body.session;
}

export async function fetchAnalytics(
  payFetch: typeof fetch,
  token: string,
  days = 30,
): Promise<AnalyticsResponse> {
  return (await unwrap(
    await payFetch(`${GATEWAY_URL}/v1/analytics?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  )) as AnalyticsResponse;
}

export interface StreamTicket {
  delivery_token: string;
  expires_at: string;
  model: string;
  quote: {
    input_tokens: number;
    authorized_output_tokens: number;
    amount_usd: number;
    amount_atomic: string;
  };
}

/** Pay for a streamed completion; returns the ticket that delivers it. */
export async function payForStream(
  payFetch: typeof fetch,
  token: string,
  body: { model: string; messages: ChatMessage[]; max_tokens: number },
): Promise<StreamTicket> {
  return (await unwrap(
    await payFetch(`${GATEWAY_URL}/v1/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  )) as StreamTicket;
}

export interface RequestDetail {
  id: string;
  status: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    authorized_output_tokens: number;
  };
  x402: {
    amount_usd: number;
    transaction_id: string | null;
    payer: string | null;
    status: string;
  };
}

export async function fetchRequest(
  payFetch: typeof fetch,
  token: string,
  id: string,
): Promise<RequestDetail> {
  return (await unwrap(
    await payFetch(`${GATEWAY_URL}/v1/requests/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  )) as RequestDetail;
}
