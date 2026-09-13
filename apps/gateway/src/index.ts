import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { catalogueSource, initializeCatalogue } from "./catalogue.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error.js";
import { requireSession } from "./middleware/session.js";
import { harnessHandler } from "./harness/handler.js";
import { analyticsRouter } from "./routes/analytics.js";
import { chatRouter } from "./routes/chat.js";
import { discoveryRouter } from "./routes/discovery.js";
import { harnessRouter } from "./routes/harness.js";
import { modelsRouter } from "./routes/models.js";
import { sessionsRouter } from "./routes/sessions.js";
import { initializeX402, paymentMiddleware, x402Config } from "./x402.js";

// BigInt is everywhere in this codebase (USDC atomic units) and JSON.stringify
// throws on it by default. Amounts go over the wire as decimal strings.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Per-request logs are useful when debugging but drown out the settlement
  // feed during a demo; they log at `debug` and surface as `warn` on errors.
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 400 ? "warn" : "debug",
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins,
      // The payment handshake rides on these headers in both directions.
      // x402 v1 uses X-PAYMENT / X-PAYMENT-RESPONSE; v2 uses
      // PAYMENT-SIGNATURE / PAYMENT-REQUIRED / PAYMENT-RESPONSE. A browser can
      // only read a response header that is exposed here, and the v2 payment
      // requirements arrive solely in PAYMENT-REQUIRED — hide it and the
      // client reports "Invalid payment required response".
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-PAYMENT",
        "PAYMENT-SIGNATURE",
        // @x402/fetch sets Access-Control-Expose-Headers on the request (a
        // no-op server-side), so the browser includes it in the preflight for
        // the paid retry. Without it here the retry is blocked and the payment
        // never leaves the browser.
        "Access-Control-Expose-Headers",
      ],
      exposedHeaders: [
        "X-PAYMENT-RESPONSE",
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
      ],
    }),
  );
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", network: x402Config.network });
  });

  // The harness endpoint. It resolves an opaque token to a wallet, signs the
  // x402 payment the harness cannot, and forwards to this same app over
  // loopback so the normal session/payment path runs unchanged.
  app.use("/h/:token", harnessHandler());

  // Discovery and session management are free; inference is not.
  app.use(discoveryRouter);
  app.use(modelsRouter);
  app.use(sessionsRouter);
  app.use(harnessRouter);

  // Authenticate before the payment middleware rather than inside the route
  // handlers: `requireSession` opens the async context that the x402 pricing
  // callback and settlement hooks read from, and those run within the
  // middleware, well before any handler is reached.
  //
  // GET /v1/chat/stream/:token is deliberately absent — the one-time delivery
  // token is its credential, because an EventSource cannot send headers.
  app.post("/v1/chat/completions", requireSession());
  app.post("/v1/chat/stream", requireSession());
  app.get("/v1/analytics", requireSession());
  app.get("/v1/requests/:id", requireSession());

  // Gates the routes named in the x402 route config; everything else passes.
  app.use(paymentMiddleware);

  app.use(chatRouter);
  app.use(analyticsRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: { type: "not_found", message: "No such endpoint" },
    });
  });

  app.use(errorHandler());

  return app;
}

async function main(): Promise<void> {
  await initializeX402();
  // Load the catalogue from ENS before accepting traffic, so the first request
  // is priced off published records rather than the built-in fallback.
  await initializeCatalogue();

  const app = createApp();

  app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        network: env.X402_NETWORK,
        catalogue: catalogueSource(),
      },
      "Router402 gateway listening",
    );
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, "Gateway failed to start");
  process.exit(1);
});
