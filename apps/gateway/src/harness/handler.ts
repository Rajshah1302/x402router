import type { NextFunction, Request, Response } from "express";
import { issueSessionToken } from "../auth/session.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { createHarnessPaymentHeader } from "../x402.js";
import { decryptPrivateKey, hashHarnessToken } from "./crypto.js";

/**
 * The harness endpoint: `/h/<token>/v1/...`.
 *
 * An AI harness (opencode, Cursor, an SDK) can't sign x402 payments, so the
 * gateway signs on the wallet's behalf using the key behind the token, then
 * forwards the request to its own public API over loopback. That way every
 * payment runs through the existing session + x402 middleware + facilitator
 * path — this handler only adds the credentials a harness cannot supply.
 */

const GATED = new Set(["/v1/chat/completions", "/v1/chat/stream"]);

interface HarnessRecord {
  id: string;
  accountId: string;
  sessionAccountId: string;
  network: string;
  privateKeyEnc: string;
  spendCapAtomic: bigint;
  perRequestCapAtomic: bigint;
  ttlHours: number;
  revokedAt: Date | null;
  account: { walletAddress: string };
}

function loopback(path: string): string {
  return `http://127.0.0.1:${env.PORT}${path}`;
}

/** Reuse a live session for the harness, or open one with its stored caps. */
async function ensureSession(record: HarnessRecord): Promise<string> {
  const now = new Date();

  const existing = await prisma.session.findFirst({
    where: {
      accountId: record.accountId,
      sessionAccountId: record.sessionAccountId,
      network: record.network,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing && existing.spentAtomic < existing.spendCapAtomic) {
    return issueSessionToken(
      {
        sessionId: existing.id,
        accountId: record.accountId,
        walletAddress: record.account.walletAddress,
      },
      existing.expiresAt,
    );
  }

  const expiresAt = new Date(now.getTime() + record.ttlHours * 3_600_000);
  const session = await prisma.session.create({
    data: {
      accountId: record.accountId,
      sessionAccountId: record.sessionAccountId,
      // No public key: the gateway holds the signing key for harness sessions.
      sessionPublicKey: "harness",
      network: record.network,
      spendCapAtomic: record.spendCapAtomic,
      perRequestCapAtomic: record.perRequestCapAtomic,
      expiresAt,
    },
  });

  return issueSessionToken(
    {
      sessionId: session.id,
      accountId: record.accountId,
      walletAddress: record.account.walletAddress,
    },
    expiresAt,
  );
}

/** Forward a normal request and return its response verbatim. */
async function proxy(
  req: Request,
  res: Response,
  path: string,
  headers: Record<string, string>,
): Promise<void> {
  const upstream = await fetch(loopback(path), {
    method: req.method,
    headers:
      req.method === "GET"
        ? headers
        : { ...headers, "Content-Type": "application/json" },
    ...(req.method === "GET"
      ? {}
      : { body: JSON.stringify(req.body ?? {}) }),
  });

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.type(contentType);
  res.status(upstream.status).send(text);
}

/**
 * OpenAI clients always stream. Router402 streams over a two-endpoint dance
 * (pay, then collect), so pay here and pipe the delivery stream straight back —
 * the chunk shape is already OpenAI-compatible.
 */
async function streamChat(
  req: Request,
  res: Response,
  headers: Record<string, string>,
): Promise<void> {
  const ticketRes = await fetch(loopback("/v1/chat/stream"), {
    method: "POST",
    headers,
    body: JSON.stringify(req.body),
  });

  if (!ticketRes.ok) {
    const text = await ticketRes.text();
    res.status(ticketRes.status).type("application/json").send(text);
    return;
  }

  const ticket = (await ticketRes.json()) as { delivery_token: string };
  const streamRes = await fetch(
    loopback(`/v1/chat/stream/${ticket.delivery_token}`),
  );

  if (!streamRes.ok || !streamRes.body) {
    res.status(502).json({
      error: { type: "harness_error", message: "Delivery failed" },
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const reader = streamRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export function harnessHandler() {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const token = String(req.params.token ?? "");
      const record = (await prisma.harnessToken.findUnique({
        where: { tokenHash: hashHarnessToken(token) },
        include: { account: true },
      })) as HarnessRecord | null;

      if (!record || record.revokedAt) {
        res.status(404).json({
          error: {
            type: "not_found",
            message: "Unknown or revoked harness token",
          },
        });
        return;
      }

      await prisma.harnessToken.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      });

      const sessionToken = await ensureSession(record);
      const path = (req.url.split("?")[0] || "/").replace(/\/+$/, "") || "/";

      logger.info(
        { path, accountId: record.accountId, harnessTokenId: record.id },
        "harness request",
      );

      const headers: Record<string, string> = {
        Authorization: `Bearer ${sessionToken}`,
      };

      const isGated = req.method === "POST" && GATED.has(path);
      if (isGated) {
        headers["Content-Type"] = "application/json";
        headers["PAYMENT-SIGNATURE"] = await createHarnessPaymentHeader(
          req.body,
          record.sessionAccountId,
          decryptPrivateKey(record.privateKeyEnc),
        );
      }

      const wantsStream =
        req.method === "POST" &&
        path === "/v1/chat/completions" &&
        req.body?.stream === true;

      if (wantsStream) {
        await streamChat(req, res, headers);
      } else {
        await proxy(req, res, path, headers);
      }
    } catch (error) {
      logger.error({ err: error }, "Harness request failed");
      if (!res.headersSent) {
        res.status(502).json({
          error: {
            type: "harness_error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  };
}
