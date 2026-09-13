import { NETWORK } from "./gateway";

/** A HashScan link for a Hedera transaction id like `0.0.1@1700000000.000000000`. */
export function hashscanUrl(transactionId: string): string {
  const host = NETWORK === "hedera:mainnet" ? "mainnet" : "testnet";
  const [account, rest] = transactionId.split("@");
  if (!account || !rest) {
    return `https://hashscan.io/${host}/transaction/${transactionId}`;
  }
  const [seconds, nanos] = rest.split(".");
  return `https://hashscan.io/${host}/transaction/${account}-${seconds}-${nanos ?? "0"}`;
}
