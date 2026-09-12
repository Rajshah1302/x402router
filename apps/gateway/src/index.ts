import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error.js";
import { requireSession } from "./middleware/session.js";
import { analyticsRouter } from "./routes/analytics.js";
import { chatRouter } from "./routes/chat.js";
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
  app.use(pinoHttp({ logger }));
  app.use(
    cors({
      origin: env.corsOrigins,
      // The payment handshake rides on these headers in both directions.
      allowedHeaders: ["Content-Type", "Authorization", "X-PAYMENT"],
      exposedHeaders: ["X-PAYMENT-RESPONSE"],
    }),
  );
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", network: x402Config.network });
  });

  // Discovery and session management are free; inference is not.
  app.use(modelsRouter);
  app.use(sessionsRouter);

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

  const app = createApp();

  app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, network: env.X402_NETWORK },
      "Router402 gateway listening",
    );
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, "Gateway failed to start");
  process.exit(1);
});
