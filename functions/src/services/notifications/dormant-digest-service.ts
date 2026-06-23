import { db, FieldValue } from "../../config/firebase-admin";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import {
  resolveNotificationPreferencesFromUiConfig,
  resolveQuietHoursFromUiConfig,
} from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";

const TX_LIMIT = 2000;

export type DormantDigestCopy = {
  title: string;
  body: string;
};

/**
 * Deterministic push copy for dormant digest (BL-01 — no LLM).
 * @param {number} dormantCount Number of dormant customers.
 * @param {number} revenueAtRiskPhp Estimated revenue at risk in PHP.
 * @return {DormantDigestCopy} Push notification title and body.
 */
export function buildDormantDigestCopy(
  dormantCount: number,
  revenueAtRiskPhp: number,
): DormantDigestCopy {
  const sukiLabel = dormantCount === 1 ? "suki" : "sukis";
  const revenue =
    revenueAtRiskPhp > 0 ?
      ` About ₱${Math.round(revenueAtRiskPhp).toLocaleString("en-PH")} at risk.` :
      "";
  return {
    title: `${dormantCount} dormant ${sukiLabel}`,
    body: `Open Forecast to win them back.${revenue}`,
  };
}

export function shouldSendDormantDigestNow(
  uiConfig: Record<string, unknown> | undefined,
  lastSentDate: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.dormantPushEnabled !== true) return false;
  const hour = manilaHour(now);
  if (hour !== Number(prefs.dormantPushHour)) return false;
  const today = manilaDateKey(now);
  if (lastSentDate === today) return false;
  return true;
}

/**
 * Sends dormant digest push for one business when prefs and schedule match.
 * @param {string} businessId Business id.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<{sent: boolean, dormantCount: number}>} Send outcome.
 */
export async function sendDormantDigestForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean; dormantCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) {
    return { sent: false, dormantCount: 0 };
  }

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastSentDate =
    typeof data.dormantDigestLastSentDate === "string" ?
      data.dormantDigestLastSentDate :
      undefined;

  if (!shouldSendDormantDigestNow(uiConfig, lastSentDate, now)) {
    return { sent: false, dormantCount: 0 };
  }

  const [customers, transactions, devices] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_LIMIT,
    }),
    listOwnerDevices(businessId),
  ]);

  const snapshot = buildDormantSignalsSnapshot(customers, transactions, now);
  const dormantCount = Number(snapshot.dormantCount ?? 0);
  if (dormantCount <= 0) {
    return { sent: false, dormantCount: 0 };
  }

  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (tokens.length === 0) {
    return { sent: false, dormantCount };
  }

  const revenueAtRiskPhp = Number(snapshot.revenueAtRiskPhp ?? 0);
  const copy = buildDormantDigestCopy(dormantCount, revenueAtRiskPhp);

  const quietHours = resolveQuietHoursFromUiConfig(uiConfig);
  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: "dormant_digest",
      businessId,
      dormantCount: String(dormantCount),
      deepLink: "/dashboard",
    },
  }, {
    quietHoursStart: quietHours.start,
    quietHoursEnd: quietHours.end,
    deliveryLog: {
      businessId,
      category: "dormant_digest",
      audience: "owner",
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(businessId, invalidTokens);
  }

  if (successCount > 0) {
    await businessRef.set(
      {
        dormantDigestLastSentDate: manilaDateKey(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true, dormantCount };
  }

  return { sent: false, dormantCount };
}
