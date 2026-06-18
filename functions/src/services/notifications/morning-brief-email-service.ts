import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { buildMorningBriefEmail } from "../../utils/morning-brief-email-template";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import {
  resolveNotificationPreferencesFromUiConfig,
} from "../../utils/notification-preferences";
import { manilaDateKey, manilaHour } from "../../utils/philippine-datetime";

export function shouldSendMorningBriefEmailNow(
  uiConfig: Record<string, unknown> | undefined,
  lastSentDate: string | undefined,
  now = new Date(),
): boolean {
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.morningBriefEmailEnabled !== true) return false;
  if (manilaHour(now) !== Number(prefs.dormantPushHour)) return false;
  return manilaDateKey(now) !== lastSentDate;
}

/**
 * NT-20 — email owner the latest auto morning brief summary.
 */
export async function sendMorningBriefEmailForBusiness(
  businessId: string,
  brief: {
    title: string;
    summary: string;
    highlights: string[];
    actionItems?: Array<{ label: string; detail: string }>;
    historyRunId?: string;
  },
  now = new Date(),
): Promise<{ sent: boolean }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessDoc = await businessRef.get();
  if (!businessDoc.exists) return { sent: false };

  const data = businessDoc.data() ?? {};
  const uiConfig = (data.uiConfig ?? {}) as Record<string, unknown>;
  const lastSentDate =
    typeof data.morningBriefEmailLastSentDate === "string" ?
      data.morningBriefEmailLastSentDate :
      undefined;

  if (!shouldSendMorningBriefEmailNow(uiConfig, lastSentDate, now)) {
    return { sent: false };
  }

  const recipient = await resolveOwnerEmailForBusiness(data);
  if (!recipient) return { sent: false };

  const dashboardUrl = `${resolveAppBaseUrlForEmail()}/dashboard`;
  const historyUrl = brief.historyRunId ?
    `${dashboardUrl}?riverAiHistory=${encodeURIComponent(brief.historyRunId)}` :
    `${dashboardUrl}?riverAiTools=history`;

  const tpl = buildMorningBriefEmail({
    ownerName: recipient.name,
    businessName: String(data.name || "Your station"),
    briefTitle: brief.title || "Morning brief",
    briefSummary: brief.summary,
    highlights: brief.highlights,
    actionItems: brief.actionItems,
    dashboardUrl,
    historyUrl,
  });

  const dateKey = manilaDateKey(now);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: morning brief email", {
      businessId,
      email: recipient.email,
    });
    await businessRef.set(
      { morningBriefEmailLastSentDate: dateKey, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { sent: true };
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
    { morningBriefEmailLastSentDate: dateKey, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.info("morning_brief_email_sent", { businessId, email: recipient.email });
  return { sent: true };
}
