"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatCompletionChunk, ChatMessage } from "@router402/shared";
import {
  GATEWAY_URL,
  fetchModels,
  type ModelOption,
  type StreamTicket,
} from "@/lib/gateway";
import { formatUsd } from "@/lib/asset";
import { LocalKeyWallet } from "@/lib/wallet";
import { payWithProgress, type PaymentProgress } from "@/lib/x402-flow";
import { useSession } from "@/lib/session-context";
import { PaymentFlow } from "@/components/payment-flow";

interface Turn extends ChatMessage {
  id: string;
  /** Per-response payment facts, filled in as they become known. */
  cost?: {
    amountUsd: number;
    authorizedOutputTokens: number;
    actualOutputTokens?: number;
    requestId?: string;
    transactionId?: string | null;
  };
  pending?: boolean;
  failed?: string;
  /** Live x402 payment progress, driving the inline animation. */
  flow?: PaymentProgress;
  elapsedMs?: number;
}

const MAX_TOKENS_CHOICES = [256, 512, 1024, 2048, 4096];

export function Chat() {
  const { wallet, session, token, refresh } = useSession();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState("");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels()
      .then((list) => {
        setModels(list);
        setModelId((current) => current || (list[0]?.id ?? ""));
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns]);

  const send = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || !token || busy) return;

    setError(null);
    setBusy(true);
    setDraft("");

    const history: ChatMessage[] = [
      ...turns
        .filter((turn) => !turn.failed)
        .map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: prompt },
    ];

    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    const replyId = crypto.randomUUID();

    setTurns((current) => [
      ...current,
      userTurn,
      { id: replyId, role: "assistant", content: "", pending: true, flow: { phase: "quoting" } },
    ]);

    const patch = (changes: Partial<Turn>) =>
      setTurns((current) =>
        current.map((turn) =>
          turn.id === replyId ? { ...turn, ...changes } : turn,
        ),
      );

    const startedAt = Date.now();
    const onProgress = (progress: PaymentProgress) =>
      setTurns((current) =>
        current.map((turn) =>
          turn.id === replyId
            ? {
                ...turn,
                flow: {
                  ...(turn.flow ?? { phase: "quoting" as const }),
                  ...progress,
                },
              }
            : turn,
        ),
      );

    try {
      if (!(wallet instanceof LocalKeyWallet) || !session) {
        throw new Error("Session is not ready — reconnect your wallet.");
      }

      // Step 1 — pay. The x402 handshake runs step by step so the UI can show
      // it, signed by the session key with no prompt to the user.
      const { response, settlement } = await payWithProgress({
        sessionAccountId: session.sessionAccountId,
        sessionPrivateKey: wallet.exportPrivateKey(),
        perRequestCapAtomic: (
          BigInt(session.spendCapAtomic) - BigInt(session.spentAtomic)
        ).toString(),
        url: `${GATEWAY_URL}/v1/chat/stream`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: history,
            max_tokens: maxTokens,
          }),
        },
        onProgress,
      });

      if (!response.ok) {
        throw new Error(
          (await response.text()) || `Payment failed (${response.status})`,
        );
      }

      const ticket = (await response.json()) as StreamTicket;

      patch({
        cost: {
          amountUsd: ticket.quote.amount_usd,
          authorizedOutputTokens: ticket.quote.authorized_output_tokens,
          transactionId: settlement?.transactionId ?? null,
        },
      });

      // Step 2 — collect. The payment has settled, so this leg is ungated and
      // streams token by token.
      const streamResponse = await fetch(
        `${GATEWAY_URL}/v1/chat/stream/${ticket.delivery_token}`,
      );

      if (!streamResponse.ok || !streamResponse.body) {
        throw new Error(`Delivery failed with status ${streamResponse.status}`);
      }

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let requestId: string | undefined;
      let actualOutputTokens: number | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The last element may be a partial line; keep it for the next chunk.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;

          const event = JSON.parse(payload) as
            | ChatCompletionChunk
            | { error: { message: string; request_id?: string } };

          if ("error" in event) {
            throw new Error(event.error.message);
          }

          requestId = event.id.replace(/^chatcmpl_/, "");
          const delta = event.choices[0]?.delta.content;
          if (delta) {
            text += delta;
            patch({ content: text, pending: true });
          }
          if (event.usage) {
            actualOutputTokens = event.usage.completion_tokens;
          }
        }
      }

      patch({
        content: text,
        pending: false,
        elapsedMs: Date.now() - startedAt,
        cost: {
          amountUsd: ticket.quote.amount_usd,
          authorizedOutputTokens: ticket.quote.authorized_output_tokens,
          actualOutputTokens,
          requestId,
          transactionId: settlement?.transactionId ?? null,
        },
      });

      void refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      patch({ pending: false, failed: message });
    } finally {
      setBusy(false);
    }
  }, [busy, draft, maxTokens, modelId, refresh, token, turns, wallet, session]);

  const selected = models.find((model) => model.id === modelId);

  return (
    <div className="chat">
      <header className="chat-header">
        <div className="row">
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            aria-label="Model"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>

          <select
            value={maxTokens}
            onChange={(event) => setMaxTokens(Number(event.target.value))}
            aria-label="Output budget"
            style={{ width: "auto" }}
          >
            {MAX_TOKENS_CHOICES.map((value) => (
              <option key={value} value={value}>
                {value} output tokens
              </option>
            ))}
          </select>
        </div>

        {selected ? (
          <span className="pill">
            ≈ ${selected.pricing.example_1k_prompt_256_completion_usd.toFixed(5)}{" "}
            per 1k-token prompt
          </span>
        ) : null}
      </header>

      <div className="chat-log" ref={logRef}>
        {turns.length === 0 ? (
          <div className="chat-empty">
            <p>
              Ask anything. Each answer is priced before it runs, paid for with
              your session key, and settled in USDC on Hedera.
            </p>
          </div>
        ) : null}

        {turns.map((turn) => (
          <article key={turn.id} className="message" data-role={turn.role}>
            <div className="message-role">
              {turn.role === "user" ? "You" : (selected?.name ?? "Assistant")}
            </div>
            {turn.flow ? (
              <PaymentFlow
                phase={turn.flow.phase}
                challenge={turn.flow.challenge}
                settlement={turn.flow.settlement}
                done={!turn.pending}
                failed={turn.failed}
                elapsedMs={turn.elapsedMs}
              />
            ) : null}
            <div className="message-body">
              {turn.failed ? (
                <span style={{ color: "var(--danger)" }}>{turn.failed}</span>
              ) : (
                turn.content || (turn.pending ? "…" : "")
              )}
            </div>
            {turn.cost ? (
              <div className="message-meta">
                <span>{formatUsd(turn.cost.amountUsd)}</span>
                <span>
                  {turn.cost.actualOutputTokens ?? "—"} /{" "}
                  {turn.cost.authorizedOutputTokens} output tokens used
                </span>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="composer">
        {error ? (
          <div className="notice" data-tone="error">
            {error}
          </div>
        ) : null}
        <div className="composer-inner">
          <textarea
            value={draft}
            placeholder="Send a message"
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button disabled={busy || !draft.trim()} onClick={() => void send()}>
            {busy ? "Paying…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
