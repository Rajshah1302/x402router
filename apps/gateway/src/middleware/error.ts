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

function classify(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof InvalidRequestError)
    return new HttpError(error.status, error.message);
  if (error instanceof WalletAuthError)
    return new HttpError(401, error.message, "authentication_error");
  if (error instanceof ProviderUnavailableError)
    return new HttpError(503, error.message, "provider_unavailable");
  return new HttpError(500, "Internal gateway error", "internal_error");
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
