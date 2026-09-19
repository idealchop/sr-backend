import { logger } from "firebase-functions";
import { db } from "../../config/firebase-admin";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { CustomerService, type Customer } from "../customers/customer-service";
import { TransactionService, type Transaction } from "../transactions/transaction-service";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { planAllowsForecast } from "../../utils/subscription-plan-codes";
import { manilaDateKey } from "../../utils/philippine-datetime";
import {
  buildScheduleWeekSuggestions,
  forecastWindowBounds,
  instantToManilaDateKey,
  isOccupiedForecastStatus,
  type ForecastCustomerInput,
  type OccupiedForecastSlot,
} from "../../utils/forecast-schedule-week";
import {
  ProactiveScheduleWeekSnapshotService,
  type ForecastLastWeekAccuracy,
  type ProactiveScheduleSuggestionInput,
  type ProactiveScheduleWeekSnapshotDTO,
} from "./proactive-schedule-week-snapshot-service";

const TX_LIMIT = 2000;

function fallbackWaterType(business: Record<string, unknown> | undefined): string {
  const types = business?.waterTypes;
  if (!Array.isArray(types) || types.length === 0) return "Purified";
  const first = types[0] as { water?: string };
  return String(first?.water || "Purified");
}

function lastFulfilledOfKind(
  customerId: string,
  kind: "delivery" | "collection",
  transactions: Transaction[],
): ForecastCustomerInput["lastFulfilled"] {
  const rows = transactions
    .filter((tx) => {
      if (tx.customerId !== customerId || tx.type !== kind) return false;
      const status = String(tx.deliveryStatus || "");
      return ["delivered", "completed", "collected"].includes(status);
    })
    .sort((a, b) => {
      const aKey = instantToManilaDateKey(a.deliveredAt || a.scheduledAt || a.createdAt) || "";
      const bKey = instantToManilaDateKey(b.deliveredAt || b.scheduledAt || b.createdAt) || "";
      return bKey.localeCompare(aKey);
    });
  const last = rows[0];
  if (!last) return undefined;
  return {
    type: kind,
    waterRefills: last.waterRefills,
    collectionItems: last.collectionItems,
  };
}

function occupiedSlotsFromTransactions(
  transactions: Transaction[],
): OccupiedForecastSlot[] {
  const out: OccupiedForecastSlot[] = [];
  for (const tx of transactions) {
    if (tx.type !== "delivery" && tx.type !== "collection") continue;
    if (!tx.customerId) continue;
    if (!isOccupiedForecastStatus(tx.deliveryStatus)) continue;
    const dateKey = instantToManilaDateKey(tx.scheduledAt || tx.createdAt);
    if (!dateKey) continue;
    out.push({ customerId: tx.customerId, kind: tx.type, dateKey });
  }
  return out;
}

function toSnapshotRows(
  suggestions: ReturnType<typeof buildScheduleWeekSuggestions>,
  previousById: Map<string, ProactiveScheduleSuggestionInput>,
): ProactiveScheduleSuggestionInput[] {
  return suggestions.map((row) => {
    const prev = previousById.get(row.id);
    return {
      id: row.id,
      customerId: row.customerId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      scheduledDate: row.scheduledDate,
      kind: row.kind,
      refillItems: row.predictedItems,
      returnContainers: [],
      rationale: row.rationale,
      reason: row.reason,
      source: row.source,
      predictedDate: row.predictedDate,
      predictedQty: row.predictedQty,
      predictedItems: row.predictedItems,
      recommendedAction: row.recommendedAction,
      outcome: prev?.outcome === "hit" || prev?.outcome === "missed" ? prev.outcome : "pending",
      ...(prev?.calledAt ? { calledAt: prev.calledAt } : {}),
      ...(prev?.matchedTransactionId ? { matchedTransactionId: prev.matchedTransactionId } : {}),
      ...(typeof prev?.actualQty === "number" ? { actualQty: prev.actualQty } : {}),
      ...(prev?.actualItems ? { actualItems: prev.actualItems } : {}),
      ...(typeof prev?.dateDeltaDays === "number" ? { dateDeltaDays: prev.dateDeltaDays } : {}),
      ...(typeof prev?.qtyScore === "number" ? { qtyScore: prev.qtyScore } : {}),
      ...(typeof prev?.productScore === "number" ? { productScore: prev.productScore } : {}),
      ...(typeof prev?.overallScore === "number" ? { overallScore: prev.overallScore } : {}),
    };
  });
}

function windowLabel(start: string, end: string): string {
  return `${start} – ${end}`;
}

export async function listAllBusinessIds(): Promise<string[]> {
  const ids: string[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (let page = 0; page < 500; page += 1) {
    let query = db.collection("businesses").orderBy("__name__").limit(100);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    if (snap.empty) break;
    for (const doc of snap.docs) ids.push(doc.id);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 100) break;
  }
  return ids;
}

export async function businessAllowsForecast(businessId: string): Promise<boolean> {
  try {
    const status = await SubscriptionService.getSubscriptionStatus(businessId);
    return planAllowsForecast(String(status?.planCode || ""));
  } catch (error) {
    logger.warn("forecast generate: subscription status failed", { businessId, error });
    return false;
  }
}

export async function generateForecastScheduleWeekForBusiness(
  businessId: string,
  options: { lastWeekAccuracy?: ForecastLastWeekAccuracy } = {},
): Promise<ProactiveScheduleWeekSnapshotDTO | null> {
  const allowed = await businessAllowsForecast(businessId);
  if (!allowed) return null;

  const [customers, transactions, businessSnap, previous] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: TX_LIMIT }),
    db.collection("businesses").doc(businessId).get(),
    ProactiveScheduleWeekSnapshotService.getLatest(businessId),
  ]);

  const bounds = forecastWindowBounds(manilaDateKey());
  const fallbackType = fallbackWaterType(
    businessSnap.data() as Record<string, unknown> | undefined,
  );
  const occupied = occupiedSlotsFromTransactions(transactions);
  const customerInputs: ForecastCustomerInput[] = customers.map((customer: Customer) => ({
    id: customer.id || "",
    name: customer.name,
    phone: customer.phone,
    status: customer.status,
    deliveryConfig: customer.deliveryConfig,
    collectionConfig: customer.collectionConfig,
    forecastAccuracyRollup: customer.forecastAccuracyRollup,
    lastFulfilledByKind: {
      delivery: lastFulfilledOfKind(customer.id || "", "delivery", transactions),
      collection: lastFulfilledOfKind(customer.id || "", "collection", transactions),
    },
  })).filter((row) => row.id);

  const built = buildScheduleWeekSuggestions({
    customers: customerInputs,
    occupiedSlots: occupied,
    windowStartKey: bounds.windowStart,
    fallbackWaterType: fallbackType,
  });

  const previousById = new Map((previous?.suggestions || []).map((row) => [row.id, row]));
  const rows = toSnapshotRows(built, previousById);

  await ProactiveScheduleWeekSnapshotService.upsert(businessId, {
    windowLabel: windowLabel(bounds.windowStart, bounds.windowEnd),
    suggestions: rows,
    source: "schedule_batch",
    windowStart: bounds.windowStart,
    windowEnd: bounds.windowEnd,
    lastWeekAccuracy: options.lastWeekAccuracy || previous?.lastWeekAccuracy,
  });

  return ProactiveScheduleWeekSnapshotService.getLatest(businessId);
}

export async function generateForecastScheduleWeekForAllBusinesses(): Promise<{
  processed: number;
  written: number;
}> {
  const ids = await listAllBusinessIds();
  let written = 0;
  let processed = 0;
  for (const businessId of ids) {
    processed += 1;
    try {
      const snap = await generateForecastScheduleWeekForBusiness(businessId);
      if (snap) written += 1;
    } catch (error) {
      logger.error("forecast generate business failed", { businessId, error });
    }
  }
  logger.info("generateForecastScheduleWeek complete", { processed, written });
  return { processed, written };
}
