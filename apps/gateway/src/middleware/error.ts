import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger.js";
import { InvalidRequestError } from "../quote.js";
import { ProviderUnavailableError } from "../providers/index.js";
import { WalletAuthError } from "../auth/wallet.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "invalid_request_error",
  ) {
    super(message);
  }
}

/**
 * Upstream failures are the caller's business, not an internal fault: a quota
 * exhaustion or a provider capacity blip should read as 429/503 with the real
 * reason, so a client knows whether retrying is worth it.
 */
function classifyUpstream(error: unknown): HttpError | null {
  if (typeof error !== "object" || error === null) return null;

  const status = (error as { status?: unknown }).status;
  const message = (error as { message?: unknown }).message;
  if (typeof status !== "number" || typeof message !== "string") return null;

  // Google puts a JSON error document inside the message string; Anthropic
  // puts the status on the error object. Prefer the document when it parses.
  const { code, detail } = unwrapProviderMessage(message, status);

  if (code === 429) {
    return new HttpError(
      429,
      `Upstream rate limit: ${detail}`,
      "upstream_rate_limit",
    );
  }
  if (code === 401 || code === 403) {
    return new HttpError(
      503,
      "The gateway's upstream provider credentials were rejected",
      "provider_unavailable",
    );
  }
  if (code >= 500) {
    return new HttpError(
      503,
      `Upstream provider unavailable: ${detail}`,
      "upstream_unavailable",
    );
  }
  if (code === 400) {
    return new HttpError(400, `Upstream rejected the request: ${detail}`);
  }

  return null;
}

/**
 * Pull a status and a human sentence out of a provider error message, which
 * may be plain text or a JSON error document (sometimes nested one level, as
 * Gemini does when it proxies an upstream failure).
 */
function unwrapProviderMessage(
  message: string,
  fallbackStatus: number,
): { code: number; detail: string } {
  let code = fallbackStatus;
  let detail = message;

  for (let depth = 0; depth < 3; depth += 1) {
    const start = detail.indexOf("{");
    if (start === -1) break;

    let parsed: unknown;
    try {
      parsed = JSON.parse(detail.slice(start));
    } catch {
      break;
    }

    const inner = (parsed as { error?: unknown }).error;
    if (typeof inner !== "object" || inner === null) break;

    const { code: innerCode, message: innerMessage } = inner as {
      code?: unknown;
      message?: unknown;
    };

    if (typeof innerCode === "number") code = innerCode;
    if (typeof innerMessage !== "string") break;

    detail = innerMessage;
  }

  // Collapse the multi-line quota dumps providers like to return.
  return { code, detail: detail.replace(/\s+/g, " ").trim().slice(0, 300) };
}

function classify(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof InvalidRequestError)
    return new HttpError(error.status, error.message);
  if (error instanceof WalletAuthError)
    return new HttpError(401, error.message, "authentication_error");
  if (error instanceof ProviderUnavailableError)
    return new HttpError(503, error.message, "provider_unavailable");
  return (
    classifyUpstream(error) ??
    new HttpError(500, "Internal gateway error", "internal_error")
  );
}

export function errorHandler() {
  return (
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const httpError = classify(error);

    if (httpError.status >= 500) {
      logger.error({ err: error }, "Unhandled gateway error");
    } else {
      logger.debug({ err: error }, "Request rejected");
    }

    res
      .status(httpError.status)
      .json({ error: { type: httpError.type, message: httpError.message } });
  };
}
