import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildPaymentReminderOwnerEmail } from "../../utils/payment-reminder-owner-email-template";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { computeDebtAgingBreakdown } from "../../utils/analytics-utils";
import { buildPaymentReminderQueue } from "../../utils/payment-reminder-queue";
import { CustomerService } from "../customers/customer-service";
import { TransactionService } from "../transactions/transaction-service";
import {
  isManilaMonday,
  manilaDateKey,
  manilaHour,
} from "../../utils/philippine-datetime";

export function shouldSendPaymentReminderOwnerEmailNow(
  uiConfig: Record<string, unknown> | undefined,
  lastSentWeekKey: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.paymentReminderEmailEnabled !== true) return false;
  if (prefs.paymentReminderEnabled !== true) return false;
  if (!isManilaMonday(now)) return false;
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastSentWeekKey;
}

/**
 * NT-21 — weekly owner email listing call-today payment reminders.
 */
export async function sendPaymentReminderOwnerEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean; queueCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false, queueCount: 0 };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastSentWeekKey =
    typeof data.paymentReminderEmailLastSentWeek === "string" ?
      data.paymentReminderEmailLastSentWeek :
      undefined;

  if (!shouldSendPaymentReminderOwnerEmailNow(uiConfig, lastSentWeekKey, now)) {
    return { sent: false, queueCount: 0 };
  }

  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  const [customers, transactions] = await Promise.all([
    CustomerService.getCustomersByBusiness(businessId),
    TransactionService.getTransactionsByBusiness(businessId, { limit: 2000 }),
  ]);
  const debt = computeDebtAgingBreakdown(transactions, customers);
  const queue = buildPaymentReminderQueue(debt.rows, customers, {
    paymentReminderEnabled: true,
    paymentReminder30Enabled: prefs.paymentReminder30Enabled !== false,
    paymentReminder60Enabled: prefs.paymentReminder60Enabled !== false,
    paymentReminder90Enabled: prefs.paymentReminder90Enabled !== false,
  }, now);

  if (queue.length === 0) return { sent: false, queueCount: 0 };

  const recipient = await resolveOwnerEmailForBusiness(data);
  if (!recipient) return { sent: false, queueCount: queue.length };

  const tpl = buildPaymentReminderOwnerEmail({
    ownerName: recipient.name,
    businessName: String(data.name || "Your station"),
    queue,
    dashboardUrl: `${resolveAppBaseUrlForEmail()}/dashboard`,
  });

  const weekKey = manilaDateKey(now);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: payment reminder owner email", {
      businessId,
      email: recipient.email,
      queueCount: queue.length,
    });
    await businessRef.set(
      {
        paymentReminderEmailLastSentWeek: weekKey,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true, queueCount: queue.length };
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email: recipient.email, name: recipient.name }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];

  await api.sendTransacEmail(sendSmtpEmail);

  await businessRef.set(
    {
      paymentReminderEmailLastSentWeek: weekKey,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("payment_reminder_owner_email_sent", {
    businessId,
    email: recipient.email,
    queueCount: queue.length,
  });

  return { sent: true, queueCount: queue.length };
}
