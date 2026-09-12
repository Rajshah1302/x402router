import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.js";

const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const ISSUER = "router402";
const AUDIENCE = "router402-gateway";

export interface SessionClaims {
  sessionId: string;
  accountId: string;
  walletAddress: string;
}

export async function issueSessionToken(
  claims: SessionClaims,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.sessionId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
}

export class SessionTokenError extends Error {}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const { sessionId, accountId, walletAddress } = payload as Record<
      string,
      unknown
    >;

    if (
      typeof sessionId !== "string" ||
      typeof accountId !== "string" ||
      typeof walletAddress !== "string"
    ) {
      throw new SessionTokenError("Session token is missing required claims");
    }

    return { sessionId, accountId, walletAddress };
  } catch (error) {
    if (error instanceof SessionTokenError) throw error;
    throw new SessionTokenError("Session token is invalid or has expired");
  }
}
