import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { PrivateKey } from "@hiero-ledger/sdk";
import { env } from "../env.js";

/**
 * Secrets for the harness endpoint.
 *
 * A harness token is stored only as a hash; the wallet key it signs with is
 * encrypted at rest. The key material is derived from `HARNESS_SECRET`, falling
 * back to `SESSION_JWT_SECRET` so a dev setup needs no extra config.
 */
const KEY = createHash("sha256")
  .update(env.HARNESS_SECRET ?? env.SESSION_JWT_SECRET)
  .digest();

export function generateHarnessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashHarnessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** AES-256-GCM, packed as `iv.tag.ciphertext` (base64url). */
export function encryptPrivateKey(privateKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptPrivateKey(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Malformed harness private key");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Hedera keys turn up as DER, raw ed25519, or 0x-prefixed ECDSA. */
export function parsePrivateKey(input: string): PrivateKey {
  const trimmed = input.trim().replace(/^0x/, "");
  const attempts = [
    () => PrivateKey.fromStringDer(trimmed),
    () => PrivateKey.fromStringED25519(trimmed),
    () => PrivateKey.fromStringECDSA(trimmed),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // Try the next encoding.
    }
  }
  throw new Error(
    "Could not read the harness private key. Expected DER hex, raw ed25519, or an ECDSA key.",
  );
}
