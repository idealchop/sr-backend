import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { AiToolRunService } from "../ai/ai-tool-run-service";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildPaymentReminderQueue } from "../../utils/payment-reminder-queue";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";

const UNPAID_QUEUE_THRESHOLD = 3;

export function shouldRunAutoCollectionsPulseNow(
  uiConfig: Record<string, unknown> | undefined,
  lastRunDate: string | undefined,
  unpaidQueueCount: number,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.autoCollectionsPulseEnabled !== true) return false;
  if (unpaidQueueCount < UNPAID_QUEUE_THRESHOLD) return false;
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastRunDate;
}

/**
 * AI-36 — scheduled collections_pulse when unpaid reminder queue exceeds threshold.
 */
export async function runAutoCollectionsPulseForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ ran: boolean; runId?: string }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { ran: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastRunDate =
    typeof data.collectionsPulseLastAutoRunDate === "string" ?
      data.collectionsPulseLastAutoRunDate :
      undefined;

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: 2000 }),
  ]);
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  const debt = computeDebtAgingBreakdown(transactions, customers);
  const queue = buildPaymentReminderQueue(debt.rows, customers, {
    paymentReminderEnabled: true,
    paymentReminder30Enabled: prefs.paymentReminder30Enabled !== false,
    paymentReminder60Enabled: prefs.paymentReminder60Enabled !== false,
    paymentReminder90Enabled: prefs.paymentReminder90Enabled !== false,
  }, now);

  if (!shouldRunAutoCollectionsPulseNow(uiConfig, lastRunDate, queue.length, now)) {
    return { ran: false };
  }

  const ownerId = String(data.ownerId || "").trim();
  if (!ownerId) {
    logger.warn("autoCollectionsPulse skipped — missing ownerId", { businessId });
    return { ran: false };
  }

  const dateKey = manilaDateKey(now);
  const run = await AiToolRunService.executeTool({
    businessId,
    uid: ownerId,
    tool: "collections_pulse",
    scheduledAuto: true,
    scheduledDateKey: dateKey,
  });

  await businessRef.set(
    {
      collectionsPulseLastAutoRunDate: dateKey,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ran: true, runId: run.id };
}
