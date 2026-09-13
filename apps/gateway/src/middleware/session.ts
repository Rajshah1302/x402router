import type { NextFunction, Request, Response } from "express";
import { SessionTokenError, verifySessionToken } from "../auth/session.js";
import { runWithContext, type RequestContext } from "../context.js";
import { prisma } from "../db.js";
import { isSessionNameLive } from "../session-names.js";
import { HttpError } from "./error.js";

export type SessionRecord = Awaited<ReturnType<typeof loadSession>>;

async function loadSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { account: true },
  });

  if (!session) throw new HttpError(401, "Session not found");
  if (session.revokedAt) throw new HttpError(401, "Session has been revoked");
  if (session.expiresAt <= new Date())
    throw new HttpError(401, "Session has expired");
  if (session.spentAtomic >= session.spendCapAtomic)
    throw new HttpError(402, "Session spend cap is exhausted");

  // The registry has the last word on whether the session is open. The row
  // above can only say what this gateway believes; the name says what anyone
  // can verify, and an expiry or an `unregister()` there ends the session even
  // if the row still looks healthy. A null answer means ENS could not be
  // reached, and the row stands on its own.
  if (session.ensName) {
    const live = await isSessionNameLive(session.id);
    if (live === false) {
      throw new HttpError(
        401,
        `Session name ${session.ensName} is no longer registered. Open a new session at POST /v1/sessions.`,
      );
    }
  }

  return session;
}

declare module "express-serve-static-core" {
  interface Request {
    session?: SessionRecord;
  }
}

/**
 * Authenticates the caller by session token and opens the async context the
 * x402 settlement hooks read from. Everything downstream — including the
 * payment middleware — runs inside that context.
 */
export function requireSession() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new HttpError(
          401,
          "Missing session token. Create one at POST /v1/sessions and send it as `Authorization: Bearer <token>`.",
        );
      }

      const claims = await verifySessionToken(header.slice("Bearer ".length));
      const session = await loadSession(claims.sessionId);

      req.session = session;

      const context: RequestContext = {
        accountId: session.accountId,
        sessionId: session.id,
        walletAddress: session.account.walletAddress,
      };

      runWithContext(context, () => next());
    } catch (error) {
      next(
        error instanceof SessionTokenError
          ? new HttpError(401, error.message)
          : error,
      );
    }
  };
}
