import { AsyncLocalStorage } from "node:async_hooks";
import type { PricedRequest } from "./quote.js";

/**
 * Per-request state shared between the Express handler and the x402 settlement
 * hooks. The hooks are invoked deep inside the payment middleware and never see
 * the Express `req`/`res`, so the correlation runs through async context.
 */
export interface RequestContext {
  accountId: string;
  sessionId: string;
  walletAddress: string;
  priced?: PricedRequest;
  /** Set once the inference row exists, so settlement can be attached to it. */
  inferenceRequestId?: string;
  /**
   * Set by the settlement hook once the payment row exists. The streaming path
   * settles before its inference row is created, so the request links back to
   * this payment later.
   */
  paymentId?: string;
  /** Filled in by the settlement hook. */
  settlement?: {
    transactionId: string | null;
    payer: string | null;
    amountAtomic: bigint;
    asset: string;
    network: string;
    success: boolean;
    errorMessage?: string;
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}
