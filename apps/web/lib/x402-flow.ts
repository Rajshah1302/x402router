import { NETWORK } from "./gateway";
import { ASSET } from "./asset";
import { parsePrivateKey } from "./wallet";

/**
 * The x402 handshake, step by step.
 *
 * `@x402/fetch` does the whole 402 → sign → settle dance behind a single
 * `fetch`, which is perfect for callers but gives the UI nothing to show. This
 * runs the same handshake explicitly so each real boundary can drive the
 * payment animation, and returns the settlement receipt directly (including
 * the Hedera transaction id) instead of making the UI poll for it.
 *
 * Everything is dynamically imported: the Hedera SDK is large and browser-only.
 */

export type PaymentPhase =
  | "quoting"
  | "challenge"
  | "signing"
  | "settling"
  | "settled";

export interface PaymentChallenge {
  amountAtomic: string;
  asset: string;
  payTo: string;
  feePayer: string | null;
  network: string;
}

export interface PaymentSettlement {
  success: boolean;
  transactionId: string | null;
  payer: string | null;
  network: string | null;
}

export interface PaymentProgress {
  phase: PaymentPhase;
  challenge?: PaymentChallenge;
  settlement?: PaymentSettlement;
}

export interface PayWithProgressOptions {
  sessionAccountId: string;
  sessionPrivateKey: string;
  perRequestCapAtomic: string;
  url: string;
  init: RequestInit;
  onProgress: (progress: PaymentProgress) => void;
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export async function payWithProgress({
  sessionAccountId,
  sessionPrivateKey,
  perRequestCapAtomic,
  url,
  init,
  onProgress,
}: PayWithProgressOptions): Promise<{
  response: Response;
  settlement: PaymentSettlement | null;
}> {
  const [{ x402Client, x402HTTPClient }, hedera, key] = await Promise.all([
    import("@x402/core/client"),
    import("@x402/hedera/exact/client"),
    parsePrivateKey(sessionPrivateKey),
  ]);
  const { createClientHederaSigner } = await import("@x402/hedera");

  const signer = createClientHederaSigner(sessionAccountId, key, {
    network: NETWORK,
  });

  const client = x402Client.fromConfig({
    schemes: [
      {
        network: NETWORK as `${string}:${string}`,
        client: new hedera.ExactHederaScheme(signer),
      },
    ],
    // A second ceiling under the gateway's own per-request cap: even a
    // compromised gateway cannot get this session key to sign for more.
    spendControls: {
      allowedAssets: [
        {
          network: NETWORK as `${string}:${string}`,
          asset: ASSET.id,
          maxAmountPerPayment: perRequestCapAtomic,
        },
      ],
    },
  });
  const http = new x402HTTPClient(client);

  // 1. Ask. An unpaid call comes back 402 with the payment requirements in the
  //    PAYMENT-REQUIRED header.
  onProgress({ phase: "quoting" });
  const probe = await fetch(url, init);
  if (probe.status !== 402) {
    return { response: probe, settlement: null };
  }

  const body = await probe
    .clone()
    .json()
    .catch(() => undefined);
  const requirements = http.getPaymentRequiredResponse(
    (name: string) => probe.headers.get(name),
    body,
  );
  const accept = requirements.accepts?.[0];
  onProgress({
    phase: "challenge",
    challenge: {
      amountAtomic: accept?.amount ?? "0",
      asset: accept?.asset ?? ASSET.id,
      payTo: accept?.payTo ?? "",
      feePayer:
        (accept?.extra as { feePayer?: string } | undefined)?.feePayer ?? null,
      network: accept?.network ?? NETWORK,
    },
  });

  // 2. Sign. The session key signs the Hedera transfer; the private key never
  //    leaves the browser.
  onProgress({ phase: "signing" });
  const payload = await client.createPaymentPayload(requirements);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);

  // 3. Settle. The retry carries the signed payment; the gateway verifies it
  //    and the facilitator settles on Hedera before the response returns.
  onProgress({ phase: "settling" });
  const response = await fetch(url, {
    ...init,
    headers: { ...toHeaderRecord(init.headers), ...paymentHeaders },
  });

  const { settleResponse } = await http.processPaymentResult(
    payload,
    (name: string) => response.headers.get(name),
    response.status,
  );

  const settlement: PaymentSettlement = {
    success: settleResponse?.success === true,
    transactionId: settleResponse?.transaction ?? null,
    payer: settleResponse?.payer ?? null,
    network: settleResponse?.network ?? null,
  };
  onProgress({ phase: "settled", settlement });

  return { response, settlement };
}
