import { NETWORK } from "./gateway";
import { parsePrivateKey } from "./wallet";

/**
 * Build a `fetch` that answers 402 challenges on its own.
 *
 * The session key signs each payment, so a request that needs paying is
 * retried transparently and the caller only ever sees the final response.
 * Everything here is dynamically imported: the Hedera SDK is large and
 * browser-only, and must stay out of the server bundle.
 */
export async function createPayingFetch(
  sessionAccountId: string,
  sessionPrivateKey: string,
  perRequestCapAtomic: string,
): Promise<typeof fetch> {
  const [{ wrapFetchWithPaymentFromConfig }, hedera, key] = await Promise.all([
    import("@x402/fetch"),
    import("@x402/hedera/exact/client"),
    parsePrivateKey(sessionPrivateKey),
  ]);
  const { createClientHederaSigner } = await import("@x402/hedera");

  const signer = createClientHederaSigner(sessionAccountId, key, {
    network: NETWORK,
  });

  return wrapFetchWithPaymentFromConfig(fetch, {
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
          asset: process.env.NEXT_PUBLIC_X402_ASSET ?? "0.0.429274",
          maxAmountPerPayment: perRequestCapAtomic,
        },
      ],
    },
  });
}
