import { db, FieldValue, auth } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { buildDormantDigestEmail } from "../../utils/dormant-digest-email-template";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import { buildDormantSignalsSnapshot } from "../../utils/dormant-customers";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import {
  isManilaMonday,
  manilaDateKey,
  manilaHour,
} from "../../utils/philippine-datetime";

const TX_LIMIT = 2000;

export function shouldSendDormantEmailDigestNow(
  uiConfig: Record<string, unknown> | undefined,
  lastSentWeekKey: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.dormantEmailDigestEnabled !== true) return false;
  if (!isManilaMonday(now)) return false;
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastSentWeekKey;
}

async function resolveOwnerEmail(
  businessData: Record<string, unknown>,
): Promise<{ email: string; name: string } | null> {
  const businessEmail = String(businessData.email || "").trim();
  const businessName = String(businessData.name || "Station").trim();
  const ownerId = String(businessData.ownerId || "").trim();

  if (businessEmail) {
    return { email: businessEmail, name: businessName };
  }

  if (!ownerId) return null;

  try {
    const user = await auth.getUser(ownerId);
    const email = user.email?.trim();
    if (!email) return null;
    const name = user.displayName?.trim() || businessName;
    return { email, name };
  } catch (error) {
    logger.warn("dormantEmailDigest could not resolve owner email", {
      ownerId,
      error,
    });
    return null;
  }
}

/**
 * BL-16 — weekly dormant digest email via Brevo (Monday, owner send hour).
 * @param {string} businessId Business id.
 * @param {string|null} [morningBriefSummary] Optional River AI brief excerpt.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {Promise<{sent: boolean, dormantCount: number}>} Send outcome.
 */
export async function sendDormantDigestEmailForBusiness(
  businessId: string,
  morningBriefSummary?: string | null,
  now = new Date(),
): Promise<{ sent: boolean; dormantCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false, dormantCount: 0 };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastSentWeekKey =
    typeof data.dormantEmailDigestLastSentWeek === "string" ?
      data.dormantEmailDigestLastSentWeek :
      undefined;

  if (!shouldSendDormantEmailDigestNow(uiConfig, lastSentWeekKey, now)) {
    return { sent: false, dormantCount: 0 };
  }

  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, {
      limit: TX_LIMIT,
    }),
  ]);

  const snapshot = buildDormantSignalsSnapshot(customers, transactions, now);
  const dormantCount = Number(snapshot.dormantCount ?? 0);
  if (dormantCount <= 0) {
    return { sent: false, dormantCount: 0 };
  }

  const recipient = await resolveOwnerEmail(data);
  if (!recipient) {
    logger.warn("dormantEmailDigest skipped — no recipient email", {
      businessId,
    });
    return { sent: false, dormantCount };
  }

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: Skipping dormant digest email", {
      businessId,
      email: recipient.email,
      dormantCount,
    });
    await businessRef.set(
      {
        dormantEmailDigestLastSentWeek: manilaDateKey(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true, dormantCount };
  }

  const dashboardUrl = `${resolveAppBaseUrlForEmail()}/dashboard`;
  const tpl = buildDormantDigestEmail({
    businessName: String(data.name || "Your station"),
    ownerName: recipient.name,
    dormantCount,
    revenueAtRiskPhp: Number(snapshot.revenueAtRiskPhp ?? 0),
    cadenceLateCount: Number(snapshot.cadenceLateCount ?? 0),
    dashboardUrl,
    morningBriefSummary,
  });

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: "Smart Refill",
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [{ email: recipient.email, name: recipient.name }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];

  await api.sendTransacEmail(sendSmtpEmail);

  await businessRef.set(
    {
      dormantEmailDigestLastSentWeek: manilaDateKey(now),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("dormantEmailDigest sent", {
    businessId,
    email: recipient.email,
    dormantCount,
  });

  return { sent: true, dormantCount };
}
