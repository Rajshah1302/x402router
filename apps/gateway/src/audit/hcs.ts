import { createHash } from "node:crypto";
import {
  AccountId,
  Client,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hiero-ledger/sdk";
import { env } from "../env.js";
import { parsePrivateKey } from "../harness/crypto.js";
import { logger } from "../logger.js";

/**
 * Hedera Consensus Service audit trail.
 *
 * Every settlement is published to a public HCS topic as an ordered, immutable
 * record, so the payment history is verifiable by anyone with the topic id
 * rather than only by whoever holds the database. Auditing is off unless a
 * topic and a submitting operator are configured.
 */

export interface AuditRecord {
  sessionId: string;
  accountId: string;
  payer: string | null;
  payTo: string;
  asset: string;
  network: string;
  amountAtomic: string;
  transactionId: string | null;
  createdAt: string;
  inferenceRequestId?: string;
  model?: string;
  quoteHash?: string;
}

export interface AuditResult {
  topicId: string;
  sequenceNumber: number;
  auditHash: string;
}

let client: Client | null = null;

export function auditEnabled(): boolean {
  return Boolean(
    env.HCS_AUDIT_TOPIC_ID &&
      env.HCS_AUDIT_OPERATOR_ID &&
      env.HCS_AUDIT_OPERATOR_KEY,
  );
}

export function auditTopicId(): string | undefined {
  return env.HCS_AUDIT_TOPIC_ID;
}

/** Public details about the audit topic, or null when auditing is off. */
export function auditInfo(): { topicId: string; hashscanUrl: string } | null {
  if (!auditEnabled() || !env.HCS_AUDIT_TOPIC_ID) return null;
  const host = env.X402_NETWORK === "hedera:mainnet" ? "mainnet" : "testnet";
  return {
    topicId: env.HCS_AUDIT_TOPIC_ID,
    hashscanUrl: `https://hashscan.io/${host}/topic/${env.HCS_AUDIT_TOPIC_ID}`,
  };
}

function getClient(): Client {
  if (client) return client;
  const base =
    env.X402_NETWORK === "hedera:mainnet"
      ? Client.forMainnet()
      : Client.forTestnet();
  base.setOperator(
    AccountId.fromString(env.HCS_AUDIT_OPERATOR_ID!),
    parsePrivateKey(env.HCS_AUDIT_OPERATOR_KEY!),
  );
  client = base;
  return client;
}

export function hashAuditRecord(record: AuditRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

/** Publish one settlement to the audit topic; null when auditing is off. */
export async function submitAudit(
  record: AuditRecord,
): Promise<AuditResult | null> {
  if (!auditEnabled()) return null;

  const topicId = env.HCS_AUDIT_TOPIC_ID!;
  const auditHash = hashAuditRecord(record);
  const message = JSON.stringify({ v: 1, ...record, auditHash });

  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(message)
    .execute(getClient());
  const receipt = await response.getReceipt(getClient());

  return {
    topicId,
    sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0,
    auditHash,
  };
}

/** Fire-and-forget wrapper: never let an audit failure break a request. */
export function submitAuditInBackground(
  record: AuditRecord,
  onResult: (result: AuditResult) => Promise<void>,
): void {
  if (!auditEnabled()) return;
  submitAudit(record)
    .then(async (result) => {
      if (result) await onResult(result);
    })
    .catch((error) => {
      logger.error({ err: error }, "HCS audit submission failed");
    });
}
