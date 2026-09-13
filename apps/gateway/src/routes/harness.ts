import { Router } from "express";
import { z } from "zod";
import { usdToAssetAtomic } from "@router402/shared";
import { env } from "../env.js";
import {
  encryptPrivateKey,
  generateHarnessToken,
  hashHarnessToken,
} from "../harness/crypto.js";
import { HttpError } from "../middleware/error.js";
import { requireSession } from "../middleware/session.js";
import { prisma } from "../db.js";

/**
 * Credentials that let an external AI harness call the gateway as the wallet.
 *
 * The returned URL is the secret: it embeds an opaque token, and the wallet
 * private key never appears in it. Only a hash of the token is stored, and the
 * key itself is encrypted at rest.
 */
export const harnessRouter: Router = Router();

const CreateSchema = z.object({
  /** Wallet private key (DER hex). Held encrypted; testnet only. */
  privateKey: z.string().min(1),
  spendCapUsd: z.number().positive().max(1000),
  perRequestCapUsd: z.number().positive().max(100),
  ttlHours: z.number().positive().max(720).optional(),
});

function baseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  return `${req.protocol}://${req.get("host") ?? `localhost:${env.PORT}`}`;
}

function toInfo(token: {
  id: string;
  sessionAccountId: string;
  network: string;
  spendCapAtomic: bigint;
  perRequestCapAtomic: bigint;
  ttlHours: number;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: token.id,
    sessionAccountId: token.sessionAccountId,
    network: token.network,
    spendCapAtomic: token.spendCapAtomic.toString(),
    perRequestCapAtomic: token.perRequestCapAtomic.toString(),
    ttlHours: token.ttlHours,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    active: !token.revokedAt,
  };
}

harnessRouter.post("/v1/harness/tokens", requireSession(), async (req, res, next) => {
  try {
    const body = CreateSchema.parse(req.body);
    const session = req.session!;

    const spendCapAtomic = usdToAssetAtomic(body.spendCapUsd, env.paymentAsset);
    const perRequestCapAtomic = usdToAssetAtomic(
      body.perRequestCapUsd,
      env.paymentAsset,
    );

    if (perRequestCapAtomic > spendCapAtomic) {
      throw new HttpError(
        400,
        "`perRequestCapUsd` cannot exceed `spendCapUsd`",
      );
    }

    const token = generateHarnessToken();
    const record = await prisma.harnessToken.create({
      data: {
        accountId: session.accountId,
        tokenHash: hashHarnessToken(token),
        privateKeyEnc: encryptPrivateKey(body.privateKey.trim()),
        sessionAccountId: session.account.walletAddress,
        network: env.X402_NETWORK,
        spendCapAtomic,
        perRequestCapAtomic,
        ttlHours: body.ttlHours ?? env.SESSION_DEFAULT_TTL_HOURS,
      },
    });

    res.status(201).json({
      token,
      url: `${baseUrl(req)}/h/${token}/v1`,
      info: toInfo(record),
    });
  } catch (error) {
    next(error);
  }
});

harnessRouter.get("/v1/harness/tokens", requireSession(), async (req, res, next) => {
  try {
    const tokens = await prisma.harnessToken.findMany({
      where: { accountId: req.session!.accountId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: tokens.map(toInfo) });
  } catch (error) {
    next(error);
  }
});

harnessRouter.post(
  "/v1/harness/tokens/:id/revoke",
  requireSession(),
  async (req, res, next) => {
    try {
      const existing = await prisma.harnessToken.findFirst({
        where: {
          id: String(req.params.id ?? ""),
          accountId: req.session!.accountId,
        },
      });
      if (!existing) {
        throw new HttpError(404, "No such harness token for this wallet");
      }

      const record = await prisma.harnessToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      res.json({ info: toInfo(record) });
    } catch (error) {
      next(error);
    }
  },
);
