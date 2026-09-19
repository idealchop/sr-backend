import { logger } from "firebase-functions";
import { db, FieldValue } from "../../config/firebase-admin";
import { CustomerService } from "../customers/customer-service";
import { TransactionService, type Transaction } from "../transactions/transaction-service";
import { manilaDateKey } from "../../utils/philippine-datetime";
import {
  applyForecastHitToRollup,
  applyForecastMissToRollup,
  forecastMatchWindowClosed,
  forecastRecommendedAction,
  pickForecastMatch,
  scoreForecastAccuracy,
  summarizeForecastOutcomes,
  type ForecastAccuracyRollup,
  type ForecastMatchCandidate,
  type ForecastPredictedItem,
} from "../../utils/forecast-accuracy";
import {
  instantToManilaDateKey,
  isForecastMatchableStatus,
  transactionForecastLines,
} from "../../utils/forecast-schedule-week";
import {
  ProactiveScheduleWeekSnapshotService,
  type ProactiveScheduleSuggestionInput,
} from "./proactive-schedule-week-snapshot-service";
import {
  businessAllowsForecast,
  listAllBusinessIds,
} from "./forecast-schedule-week-generate-service";

const TX_LIMIT = 2000;

function predictedDateOf(row: ProactiveScheduleSuggestionInput): string {
  if (row.predictedDate && /^\d{4}-\d{2}-\d{2}/.test(row.predictedDate)) {
    return row.predictedDate.slice(0, 10);
  }
  return String(row.scheduledDate || "").slice(0, 10);
}

function predictedItemsOf(row: ProactiveScheduleSuggestionInput): ForecastPredictedItem[] {
  if (Array.isArray(row.predictedItems) && row.predictedItems.length > 0) {
    return row.predictedItems;
  }
  return row.refillItems || [];
}

function predictedQtyOf(row: ProactiveScheduleSuggestionInput): number {
  if (typeof row.predictedQty === "number") return row.predictedQty;
  return predictedItemsOf(row).reduce((sum, line) => sum + line.qty, 0);
}

function toMatchCandidate(tx: Transaction): ForecastMatchCandidate | null {
  if (!tx.id || (tx.type !== "delivery" && tx.type !== "collection")) return null;
  if (!isForecastMatchableStatus(tx.deliveryStatus)) return null;
  const dateKey = instantToManilaDateKey(tx.scheduledAt || tx.createdAt);
  if (!dateKey) return null;
  const items = transactionForecastLines(tx);
  return {
    id: tx.id,
    customerId: tx.customerId,
    type: tx.type,
    dateKey,
    qty: items.reduce((sum, line) => sum + line.qty, 0),
    items,
    alreadyScored: Boolean(tx.forecastAccuracy),
  };
}

export async function scoreForecastScheduleWeekForBusiness(businessId: string): Promise<{
  hits: number;
  misses: number;
} | null> {
  const allowed = await businessAllowsForecast(businessId);
  if (!allowed) return null;

  const snapshot = await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
  if (!snapshot || snapshot.suggestions.length === 0) {
    return { hits: 0, misses: 0 };
  }

  const [transactions, customers] = await Promise.all([
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
    CustomerService.getCustomersByBusiness(businessId),
  ]);

  const todayKey = manilaDateKey();
  const scoredAt = new Date().toISOString();
  const claimedTxIds = new Set<string>();
  const customerById = new Map(customers.map((c) => [c.id || "", c]));
  const rollupUpdates = new Map<string, ForecastAccuracyRollup>();
  let hits = 0;
  let misses = 0;

  const deliveryCandidates = transactions
    .map(toMatchCandidate)
    .filter((row): row is ForecastMatchCandidate => row != null && row.type === "delivery");
  const collectionCandidates = transactions
    .map(toMatchCandidate)
    .filter((row): row is ForecastMatchCandidate => row != null && row.type === "collection");

  const nextSuggestions: ProactiveScheduleSuggestionInput[] = [];

  for (const row of snapshot.suggestions) {
    if (row.outcome === "hit" || row.outcome === "missed") {
      nextSuggestions.push(row);
      continue;
    }

    const predictedDate = predictedDateOf(row);
    const predictedItems = predictedItemsOf(row);
    const predictedQty = predictedQtyOf(row);
    const candidates = row.kind === "collection" ? collectionCandidates : deliveryCandidates;
    const match = predictedDate ?
      pickForecastMatch(
        { customerId: row.customerId, predictedDate, predictedQty },
        candidates,
        claimedTxIds,
      ) :
      null;

    if (match) {
      claimedTxIds.add(match.candidate.id);
      const scores = scoreForecastAccuracy(
        predictedQty,
        match.candidate.qty,
        predictedItems,
        match.candidate.items,
      );
      const txRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .doc(match.candidate.id);
      await txRef.update({
        forecastAccuracy: {
          suggestionId: row.id,
          predictedDate,
          kind: row.kind,
          predictedQty,
          predictedItems,
          actualQty: match.candidate.qty,
          actualItems: match.candidate.items,
          dateDeltaDays: match.dateDeltaDays,
          qtyScore: scores.qtyScore,
          productScore: scores.productScore,
          overallScore: scores.overallScore,
          scoredAt,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      const customer = customerById.get(row.customerId);
      const currentRollup = rollupUpdates.get(row.customerId) ||
        customer?.forecastAccuracyRollup ||
        {};
      const nextKind = applyForecastHitToRollup(currentRollup[row.kind], {
        predictedQty,
        actualQty: match.candidate.qty,
        items: match.candidate.items,
        overallScore: scores.overallScore,
        scoredAt,
      });
      const nextRollup: ForecastAccuracyRollup = {
        ...currentRollup,
        [row.kind]: nextKind,
      };
      rollupUpdates.set(row.customerId, nextRollup);

      nextSuggestions.push({
        ...row,
        outcome: "hit",
        recommendedAction: forecastRecommendedAction(nextKind),
        matchedTransactionId: match.candidate.id,
        actualQty: match.candidate.qty,
        actualItems: match.candidate.items,
        dateDeltaDays: match.dateDeltaDays,
        qtyScore: scores.qtyScore,
        productScore: scores.productScore,
        overallScore: scores.overallScore,
      });
      hits += 1;
      continue;
    }

    if (predictedDate && forecastMatchWindowClosed(predictedDate, todayKey)) {
      const customer = customerById.get(row.customerId);
      const currentRollup = rollupUpdates.get(row.customerId) ||
        customer?.forecastAccuracyRollup ||
        {};
      const nextKind = applyForecastMissToRollup(currentRollup[row.kind], scoredAt);
      const nextRollup: ForecastAccuracyRollup = {
        ...currentRollup,
        [row.kind]: nextKind,
      };
      rollupUpdates.set(row.customerId, nextRollup);
      nextSuggestions.push({
        ...row,
        outcome: "missed",
        recommendedAction: forecastRecommendedAction(nextKind),
      });
      misses += 1;
      continue;
    }

    nextSuggestions.push(row);
  }

  for (const [customerId, rollup] of rollupUpdates) {
    if (!customerById.has(customerId)) continue;
    await db
      .collection("businesses")
      .doc(businessId)
      .collection("customers")
      .doc(customerId)
      .update({
        forecastAccuracyRollup: rollup,
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  const accuracySummary = summarizeForecastOutcomes(nextSuggestions);
  await ProactiveScheduleWeekSnapshotService.patchSuggestions(businessId, nextSuggestions, {
    accuracySummary,
  });

  logger.info("forecast score business complete", { businessId, hits, misses });
  return { hits, misses };
}

export async function scoreForecastScheduleWeekForAllBusinesses(): Promise<{
  processed: number;
  scored: number;
}> {
  const ids = await listAllBusinessIds();
  let processed = 0;
  let scored = 0;
  for (const businessId of ids) {
    processed += 1;
    try {
      const result = await scoreForecastScheduleWeekForBusiness(businessId);
      if (result && (result.hits > 0 || result.misses > 0)) scored += 1;
    } catch (error) {
      logger.error("forecast score business failed", { businessId, error });
    }
  }
  logger.info("scoreForecastScheduleWeek complete", { processed, scored });
  return { processed, scored };
}
