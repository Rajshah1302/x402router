/**
 * Wallet abstraction.
 *
 * Router402 needs exactly two things from a wallet: the Hedera account id it
 * controls, and a signature over the session authorization message. Everything
 * after that is signed by the session key, not the wallet.
 *
 * The MVP ships `LocalKeyWallet`, which holds a Hedera private key in the
 * browser. A HashPack / WalletConnect connector implements the same two methods
 * and drops in here without touching anything else.
 */
export interface Wallet {
  readonly kind: string;
  readonly accountId: string;
  /** Hex-encoded signature over the UTF-8 bytes of `message`. */
  signMessage(message: string): Promise<string>;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hedera keys turn up in several encodings — DER hex, raw ed25519, 0x-prefixed
 * ECDSA — and the parser that accepts one rejects the others, so try in turn.
 */
export async function parsePrivateKey(input: string) {
  const { PrivateKey } = await import("@hiero-ledger/sdk");
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
    "Could not read that private key. Expected DER hex, raw ed25519, or an ECDSA key.",
  );
}

export class LocalKeyWallet implements Wallet {
  readonly kind = "local-key";

  private constructor(
    readonly accountId: string,
    private readonly privateKeyDer: string,
  ) {}

  static async connect(
    accountId: string,
    privateKey: string,
  ): Promise<LocalKeyWallet> {
    // Throws on a malformed key, which is the point: fail at connect time.
    const parsed = await parsePrivateKey(privateKey);
    return new LocalKeyWallet(accountId, parsed.toStringDer());
  }

  async signMessage(message: string): Promise<string> {
    const key = await parsePrivateKey(this.privateKeyDer);
    return toHex(key.sign(new TextEncoder().encode(message)));
  }

  /** The key itself, for the session signer. Never leaves the browser. */
  exportPrivateKey(): string {
    return this.privateKeyDer;
  }
}
