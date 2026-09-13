import { readCatalogue, type EnsAgent } from "@router402/ens";
import { MODELS, type ModelSpec } from "@router402/shared";
import { ensConfig, ensPublicClient, ensReadable } from "./ens.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * The model catalogue, read from ENS.
 *
 * `MODELS` in @router402/shared used to be the catalogue. It is now the seed
 * that gets published to ENS once, and the fallback for a checkout that has no
 * registries deployed. When ENS is configured this module is the authority,
 * and that matters beyond `/v1/models`: `priceRequest` quotes from whatever
 * this returns, so a price change is a transaction against a text record
 * rather than a redeploy of the gateway.
 *
 * The snapshot is kept warm so lookups stay synchronous on the hot path. A
 * stale snapshot is served while a refresh is in flight; ENS being briefly
 * unreachable slows nothing down and fails nothing.
 */

const REFRESH_INTERVAL_MS = 60_000;

interface Snapshot {
  source: "ens" | "builtin";
  models: readonly ModelSpec[];
  byId: Map<string, ModelSpec>;
  byUpstreamId: Map<string, ModelSpec>;
  ensNames: Map<string, string>;
  readAt: number;
}

function snapshotOf(
  source: Snapshot["source"],
  models: readonly ModelSpec[],
  agents: readonly EnsAgent[] = [],
): Snapshot {
  return {
    source,
    models,
    byId: new Map(models.map((model) => [model.id, model])),
    // Bare ids (`claude-opus-5`) resolve to their namespaced entry, as in
    // @router402/shared — clients written against OpenRouter send both.
    byUpstreamId: new Map(models.map((model) => [model.upstreamId, model])),
    ensNames: new Map(agents.map((agent) => [agent.id, agent.ensName])),
    readAt: Date.now(),
  };
}

const BUILTIN = snapshotOf("builtin", MODELS);

let snapshot: Snapshot = BUILTIN;
let inFlight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const config = ensConfig();
  const client = ensPublicClient();
  if (!config || !client) return;

  const agents = await readCatalogue(client, config);

  if (agents.length === 0) {
    // An empty registry means nothing has been published yet, not that the
    // gateway should serve no models. Keep whatever is already loaded.
    logger.warn(
      { parentName: config.parentName },
      "ENS agent registry is empty; keeping the current catalogue",
    );
    return;
  }

  // An agent's records advertise where it wants to be paid. This gateway
  // settles to one configured account, so a record that disagrees is a
  // publishing mistake — worth saying out loud rather than serving a name
  // whose terms do not match what a caller will actually be charged.
  for (const agent of agents) {
    if (agent.payTo && agent.payTo !== env.X402_PAY_TO_ACCOUNT_ID) {
      logger.warn(
        { ensName: agent.ensName, recordPayTo: agent.payTo, settlesTo: env.X402_PAY_TO_ACCOUNT_ID },
        "agent record advertises a different pay-to than this gateway settles to",
      );
    }
    if (agent.asset && agent.asset !== env.X402_ASSET_ID) {
      logger.warn(
        { ensName: agent.ensName, recordAsset: agent.asset, settlesIn: env.X402_ASSET_ID },
        "agent record advertises a different settlement asset than this gateway uses",
      );
    }
  }

  snapshot = snapshotOf("ens", agents, agents);
  logger.info(
    { count: agents.length, parentName: config.parentName },
    "model catalogue loaded from ENS",
  );
}

/** Refresh in the background, coalescing concurrent attempts. */
function refreshSoon(): void {
  if (inFlight) return;
  inFlight = refresh()
    .catch((error: unknown) => {
      logger.warn({ err: error }, "ENS catalogue refresh failed; serving the cached catalogue");
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Warm the catalogue before the server accepts traffic, so the first request
 * is not priced off the fallback while ENS is still being read.
 */
export async function initializeCatalogue(): Promise<void> {
  if (!ensReadable()) {
    logger.info("ENS is not configured; serving the built-in model catalogue");
    return;
  }

  try {
    await refresh();
  } catch (error) {
    logger.warn(
      { err: error },
      "could not read the catalogue from ENS at startup; falling back to the built-in list",
    );
  }
}

function current(): Snapshot {
  if (ensReadable() && Date.now() - snapshot.readAt > REFRESH_INTERVAL_MS) {
    refreshSoon();
  }
  return snapshot;
}

/** Every model this gateway will route, newest snapshot first. */
export function catalogueModels(): readonly ModelSpec[] {
  return current().models;
}

/** Resolve a caller-supplied model id, by full id or by bare upstream id. */
export function findModel(id: string): ModelSpec | undefined {
  const snap = current();
  return snap.byId.get(id) ?? snap.byUpstreamId.get(id);
}

/** The ENS name a model is published under, when it came from ENS. */
export function ensNameForModel(id: string): string | null {
  return current().ensNames.get(id) ?? null;
}

/** Where the catalogue in use right now came from. */
export function catalogueSource(): "ens" | "builtin" {
  return current().source;
}
