import { GATEWAY_URL } from "./gateway";
import { LocalKeyWallet } from "./wallet";

/**
 * Harness access tokens: credentials that let an AI harness call the gateway
 * as the wallet, paying x402 automatically. The wallet key is sent once and
 * held (encrypted) by the gateway; the returned URL is the secret.
 */
export interface HarnessTokenInfo {
  id: string;
  sessionAccountId: string;
  network: string;
  spendCapAtomic: string;
  perRequestCapAtomic: string;
  ttlHours: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

async function unwrap(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Gateway returned ${response.status}`);
  }
  return body;
}

export interface HarnessTerms {
  spendCapUsd: number;
  perRequestCapUsd: number;
  ttlHours: number;
}

export async function createHarnessToken(
  sessionToken: string,
  wallet: LocalKeyWallet,
  terms: HarnessTerms,
): Promise<{ token: string; url: string; info: HarnessTokenInfo }> {
  const body = await unwrap(
    await fetch(`${GATEWAY_URL}/v1/harness/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        privateKey: wallet.exportPrivateKey(),
        ...terms,
      }),
    }),
  );
  return body as unknown as { token: string; url: string; info: HarnessTokenInfo };
}

export async function listHarnessTokens(
  sessionToken: string,
): Promise<HarnessTokenInfo[]> {
  const body = await unwrap(
    await fetch(`${GATEWAY_URL}/v1/harness/tokens`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }),
  );
  return (body.data as HarnessTokenInfo[]) ?? [];
}

export async function revokeHarnessToken(
  sessionToken: string,
  id: string,
): Promise<HarnessTokenInfo> {
  const body = await unwrap(
    await fetch(`${GATEWAY_URL}/v1/harness/tokens/${id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    }),
  );
  return body.info as HarnessTokenInfo;
}

/** The opencode provider block for a given base URL and model list. */
export function opencodeConfig(
  baseUrl: string,
  models: Array<{
    id: string;
    name: string;
    /** USD per million tokens, so opencode shows a per-message cost. */
    input: number;
    output: number;
  }>,
): string {
  return JSON.stringify(
    {
      provider: {
        router402: {
          npm: "@ai-sdk/openai-compatible",
          name: "Router402",
          options: { baseURL: baseUrl, apiKey: "x402" },
          models: Object.fromEntries(
            models.map((m) => [
              m.id,
              {
                name: m.name,
                cost: { input: m.input, output: m.output },
              },
            ]),
          ),
        },
      },
    },
    null,
    2,
  );
}
