/** Wire contracts shared by the gateway and the web client. */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** OpenRouter / OpenAI-compatible request body for `POST /v1/chat/completions`. */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "content_filter" | "error";
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  /** Router402 extension: what this call cost and how it was paid. */
  x402: RequestSettlement;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: ChatCompletionChoice["finish_reason"] | null;
  }>;
  usage?: ChatCompletionUsage;
  x402?: RequestSettlement;
}

/** Payment facts attached to a served request. */
export interface RequestSettlement {
  /** USDC charged, in atomic units, serialised as a string. */
  amountAtomic: string;
  amountUsd: number;
  /** Output tokens the caller bought. */
  authorizedOutputTokens: number;
  /** Output tokens actually produced. */
  actualOutputTokens: number;
  network: string;
  asset: string;
  /** Hedera transaction id, once the facilitator has settled. */
  transactionId: string | null;
  payer: string | null;
}

export interface SessionInfo {
  id: string;
  walletAddress: string;
  /** Hedera account the session key signs for. */
  sessionAccountId: string;
  network: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Ceiling the session may spend in total, USDC atomic units as a string. */
  spendCapAtomic: string;
  spentAtomic: string;
  status: "active" | "expired" | "revoked" | "exhausted";
}

export interface UsageSummary {
  totalSpendUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  averageCostUsd: number;
}

export interface SpendBucket {
  /** ISO date, day granularity. */
  date: string;
  spendUsd: number;
  requests: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  spendUsd: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyticsResponse {
  summary: UsageSummary;
  spendOverTime: SpendBucket[];
  byModel: BreakdownRow[];
  byProvider: BreakdownRow[];
  recentRequests: RecentRequest[];
  recentPayments: RecentPayment[];
}

export interface RecentRequest {
  id: string;
  createdAt: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  status: "settled" | "failed" | "pending";
}

export interface RecentPayment {
  id: string;
  createdAt: string;
  amountUsd: number;
  amountAtomic: string;
  asset: string;
  network: string;
  transactionId: string | null;
  status: "settled" | "failed" | "pending";
}
