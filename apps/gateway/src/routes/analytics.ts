import { Router } from "express";
import {
  assetAtomicToUsd,
  type AnalyticsResponse,
  type BreakdownRow,
  type RecentPayment,
  type RecentRequest,
  type SpendBucket,
} from "@router402/shared";
import { findModel } from "../catalogue.js";
import { env } from "../env.js";
import { prisma } from "../db.js";

export const analyticsRouter: Router = Router();

const DEFAULT_WINDOW_DAYS = 30;

function labelFor(modelId: string): string {
  return findModel(modelId)?.displayName ?? modelId;
}

/**
 * Everything the Analytics screen shows, for the connected wallet only.
 *
 * Spend is taken from `amountAtomic` — what the caller actually paid — rather
 * than recomputed from tokens, so the figures reconcile with the on-chain
 * settlements rather than approximating them.
 */
analyticsRouter.get("/v1/analytics", async (req, res, next) => {
  try {
    const accountId = req.session!.accountId;
    const days = Math.min(
      Math.max(Number(req.query.days) || DEFAULT_WINDOW_DAYS, 1),
      365,
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { accountId, createdAt: { gte: since } };

    const [totals, perModel, rows, payments] = await Promise.all([
      prisma.inferenceRequest.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          amountAtomic: true,
          inputTokens: true,
          outputTokens: true,
        },
      }),
      prisma.inferenceRequest.groupBy({
        by: ["model", "provider"],
        where,
        _count: { _all: true },
        _sum: {
          amountAtomic: true,
          inputTokens: true,
          outputTokens: true,
        },
      }),
      prisma.inferenceRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          model: true,
          provider: true,
          inputTokens: true,
          outputTokens: true,
          amountAtomic: true,
          status: true,
        },
      }),
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const totalRequests = totals._count._all;
    const totalSpendUsd = assetAtomicToUsd(
      totals._sum.amountAtomic ?? 0n,
      env.paymentAsset,
    );

    const byModel: BreakdownRow[] = perModel
      .map((group) => ({
        key: group.model,
        label: labelFor(group.model),
        spendUsd: assetAtomicToUsd(
          group._sum.amountAtomic ?? 0n,
          env.paymentAsset,
        ),
        requests: group._count._all,
        inputTokens: group._sum.inputTokens ?? 0,
        outputTokens: group._sum.outputTokens ?? 0,
      }))
      .sort((a, b) => b.spendUsd - a.spendUsd);

    const providerTotals = new Map<string, BreakdownRow>();
    for (const group of perModel) {
      const existing = providerTotals.get(group.provider) ?? {
        key: group.provider,
        label: group.provider === "anthropic" ? "Anthropic" : "Google",
        spendUsd: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      existing.spendUsd += assetAtomicToUsd(
        group._sum.amountAtomic ?? 0n,
        env.paymentAsset,
      );
      existing.requests += group._count._all;
      existing.inputTokens += group._sum.inputTokens ?? 0;
      existing.outputTokens += group._sum.outputTokens ?? 0;
      providerTotals.set(group.provider, existing);
    }

    // Day buckets come from the fetched rows so the series matches the table.
    const buckets = new Map<string, SpendBucket>();
    for (const row of rows) {
      const date = row.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(date) ?? { date, spendUsd: 0, requests: 0 };
      bucket.spendUsd += assetAtomicToUsd(row.amountAtomic, env.paymentAsset);
      bucket.requests += 1;
      buckets.set(date, bucket);
    }

    const recentRequests: RecentRequest[] = rows.slice(0, 25).map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      model: row.model,
      provider: row.provider,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: assetAtomicToUsd(row.amountAtomic, env.paymentAsset),
      status:
        row.status === "SETTLED"
          ? "settled"
          : row.status === "FAILED"
            ? "failed"
            : "pending",
    }));

    const recentPayments: RecentPayment[] = payments.map((payment) => ({
      id: payment.id,
      createdAt: payment.createdAt.toISOString(),
      amountUsd: assetAtomicToUsd(payment.amountAtomic, env.paymentAsset),
      amountAtomic: payment.amountAtomic.toString(),
      asset: payment.asset,
      network: payment.network,
      transactionId: payment.transactionId,
      status:
        payment.status === "SETTLED"
          ? "settled"
          : payment.status === "FAILED"
            ? "failed"
            : "pending",
    }));

    const body: AnalyticsResponse = {
      summary: {
        totalSpendUsd,
        totalRequests,
        totalInputTokens: totals._sum.inputTokens ?? 0,
        totalOutputTokens: totals._sum.outputTokens ?? 0,
        averageCostUsd: totalRequests > 0 ? totalSpendUsd / totalRequests : 0,
      },
      spendOverTime: [...buckets.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      byModel,
      byProvider: [...providerTotals.values()].sort(
        (a, b) => b.spendUsd - a.spendUsd,
      ),
      recentRequests,
      recentPayments,
    };

    res.json(body);
  } catch (error) {
    next(error);
  }
});
