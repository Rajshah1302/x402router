import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { usdToAssetAtomic, type SessionInfo } from "@router402/shared";
import { issueSessionToken } from "../auth/session.js";
import {
  authorizationMessage,
  verifySessionAuthorization,
  type SessionAuthorization,
} from "../auth/wallet.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { requireSession } from "../middleware/session.js";

const HederaAccountId = z.string().regex(/^\d+\.\d+\.\d+$/, "expected a Hedera account id like 0.0.1234");

const CreateSessionSchema = z.object({
  walletAddress: HederaAccountId,
  /** Account the session key signs for. Usually the wallet's own account. */
  sessionAccountId: HederaAccountId,
  sessionPublicKey: z.string().min(1),
  /** Total the session may spend before the wallet must authorise again. */
  spendCapUsd: z.number().positive().max(1000),
  perRequestCapUsd: z.number().positive().max(100),
  ttlHours: z.number().positive().max(720).optional(),
  nonce: z.string().min(8),
  /** Expiry from the challenge, echoed back so both sides sign the same message. */
  expiresAt: z.iso.datetime(),
  /** Wallet signature over `authorizationMessage(...)`, hex-encoded. */
  signature: z.string().min(1),
});

export function toSessionInfo(session: {
  id: string;
  sessionAccountId: string;
  network: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  spendCapAtomic: bigint;
  spentAtomic: bigint;
  account: { walletAddress: string };
}): SessionInfo {
  const status: SessionInfo["status"] = session.revokedAt
    ? "revoked"
    : session.expiresAt <= new Date()
      ? "expired"
      : session.spentAtomic >= session.spendCapAtomic
        ? "exhausted"
        : "active";

  return {
    id: session.id,
    walletAddress: session.account.walletAddress,
    sessionAccountId: session.sessionAccountId,
    network: session.network,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() ?? null,
    spendCapAtomic: session.spendCapAtomic.toString(),
    spentAtomic: session.spentAtomic.toString(),
    status,
  };
}

export const sessionsRouter: Router = Router();

/**
 * Returns the exact string a wallet must sign to open a session. Clients build
 * the same string locally; this endpoint exists so a mismatch is easy to spot.
 */
sessionsRouter.post("/v1/sessions/challenge", (req, res, next) => {
  try {
    const body = CreateSessionSchema.omit({
      signature: true,
      expiresAt: true,
    }).parse(req.body);
    const expiresAt = new Date(
      Date.now() +
        (body.ttlHours ?? env.SESSION_DEFAULT_TTL_HOURS) * 60 * 60 * 1000,
    );

    const authorization: SessionAuthorization = {
      walletAddress: body.walletAddress,
      sessionAccountId: body.sessionAccountId,
      sessionPublicKey: body.sessionPublicKey,
      network: env.X402_NETWORK,
      spendCapAtomic: usdToAssetAtomic(body.spendCapUsd, env.paymentAsset).toString(),
      perRequestCapAtomic: usdToAssetAtomic(body.perRequestCapUsd, env.paymentAsset).toString(),
      expiresAt: expiresAt.toISOString(),
      nonce: body.nonce,
    };

    res.json({ message: authorizationMessage(authorization), authorization });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/v1/sessions", async (req, res, next) => {
  try {
    const body = CreateSessionSchema.parse(req.body);

    const expiresAt = new Date(body.expiresAt);

    const clockSkewMs = 60 * 1000;
    const maxAheadMs = 720 * 60 * 60 * 1000;
    if (expiresAt.getTime() < Date.now() - clockSkewMs) {
      throw new HttpError(400, "`expiresAt` must be in the future");
    }
    if (expiresAt.getTime() > Date.now() + maxAheadMs) {
      throw new HttpError(
        400,
        "`expiresAt` cannot be more than 720 hours in the future",
      );
    }

    const spendCapAtomic = usdToAssetAtomic(body.spendCapUsd, env.paymentAsset);
    const perRequestCapAtomic = usdToAssetAtomic(body.perRequestCapUsd, env.paymentAsset);

    if (perRequestCapAtomic > spendCapAtomic) {
      throw new HttpError(
        400,
        "`perRequestCapUsd` cannot exceed `spendCapUsd`",
      );
    }

    await verifySessionAuthorization(
      {
        walletAddress: body.walletAddress,
        sessionAccountId: body.sessionAccountId,
        sessionPublicKey: body.sessionPublicKey,
        network: env.X402_NETWORK,
        spendCapAtomic: spendCapAtomic.toString(),
        perRequestCapAtomic: perRequestCapAtomic.toString(),
        expiresAt: expiresAt.toISOString(),
        nonce: body.nonce,
      },
      body.signature,
    );

    // The wallet address is the identity — connecting is all the onboarding
    // there is, so the account row is created on first sight.
    const account = await prisma.account.upsert({
      where: { walletAddress: body.walletAddress },
      create: { walletAddress: body.walletAddress, network: env.X402_NETWORK },
      update: {},
    });

    const session = await prisma.session.create({
      data: {
        accountId: account.id,
        sessionAccountId: body.sessionAccountId,
        sessionPublicKey: body.sessionPublicKey,
        network: env.X402_NETWORK,
        spendCapAtomic,
        perRequestCapAtomic,
        expiresAt,
      },
      include: { account: true },
    });

    const token = await issueSessionToken(
      {
        sessionId: session.id,
        accountId: account.id,
        walletAddress: account.walletAddress,
      },
      expiresAt,
    );

    res.status(201).json({ token, session: toSessionInfo(session) });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/v1/sessions/current", requireSession(), (req, res) => {
  res.json({ session: toSessionInfo(req.session!) });
});

sessionsRouter.post(
  "/v1/sessions/current/revoke",
  requireSession(),
  async (req, res, next) => {
    try {
      const session = await prisma.session.update({
        where: { id: req.session!.id },
        data: { revokedAt: new Date() },
        include: { account: true },
      });
      res.json({ session: toSessionInfo(session) });
    } catch (error) {
      next(error);
    }
  },
);

/** Freshly minted nonce for the next authorization message. */
sessionsRouter.get("/v1/sessions/nonce", (_req, res) => {
  res.json({ nonce: randomUUID() });
});
