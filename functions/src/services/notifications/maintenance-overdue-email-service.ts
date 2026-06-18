import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildMaintenanceOverdueOwnerEmail } from "../../utils/maintenance-overdue-email-template";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { MaintenanceTemplateService } from "../plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../plant/maintenance-template-utils";
import {
  isManilaMonday,
  manilaDateKey,
  manilaHour,
} from "../../utils/philippine-datetime";

export function shouldSendMaintenanceOverdueEmailNow(
  uiConfig: Record<string, unknown> | undefined,
  lastSentWeekKey: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.maintenanceOverdueEmailEnabled !== true) return false;
  if (!isManilaMonday(now)) return false;
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastSentWeekKey;
}

/**
 * NT-25 — weekly owner email for overdue plant maintenance tasks.
 */
export async function sendMaintenanceOverdueEmailForBusiness(
  businessId: string,
  now = new Date(),
): Promise<{ sent: boolean; overdueCount: number }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false, overdueCount: 0 };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastSentWeekKey =
    typeof data.maintenanceOverdueEmailLastSentWeek === "string" ?
      data.maintenanceOverdueEmailLastSentWeek :
      undefined;

  if (!shouldSendMaintenanceOverdueEmailNow(uiConfig, lastSentWeekKey, now)) {
    return { sent: false, overdueCount: 0 };
  }

  const templates = await MaintenanceTemplateService.list(businessId);
  const summary = summarizeMaintenanceOverdue(templates);
  if (summary.overdueCount <= 0) return { sent: false, overdueCount: 0 };

  const recipient = await resolveOwnerEmailForBusiness(data);
  if (!recipient) return { sent: false, overdueCount: summary.overdueCount };

  const tpl = buildMaintenanceOverdueOwnerEmail({
    ownerName: recipient.name,
    businessName: String(data.name || "Your station"),
    overdueNames: summary.overdueNames,
    overdueCount: summary.overdueCount,
    dashboardUrl: `${resolveAppBaseUrlForEmail()}/inventory`,
  });

  const weekKey = manilaDateKey(now);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: maintenance overdue email", {
      businessId,
      email: recipient.email,
      overdueCount: summary.overdueCount,
    });
    await businessRef.set(
      {
        maintenanceOverdueEmailLastSentWeek: weekKey,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { sent: true, overdueCount: summary.overdueCount };
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
      maintenanceOverdueEmailLastSentWeek: weekKey,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info("maintenance_overdue_email_sent", {
    businessId,
    email: recipient.email,
    overdueCount: summary.overdueCount,
  });

  return { sent: true, overdueCount: summary.overdueCount };
}
