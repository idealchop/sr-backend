import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../../config/firebase-admin";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { coerceToDate } from "../../utils/philippine-datetime";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { resolveOwnerEmailForBusiness } from "../../utils/owner-email-resolver";
import { buildInactiveAccountDeactivationEmail } from "../../utils/inactive-account-deactivation-email-template";
import {
  isWorkspaceInactivityDeactivated,
  shouldDeactivateForInactivity,
} from "../../utils/inactive-account-deactivation-policy";

export {
  isWorkspaceInactivityDeactivated,
  shouldDeactivateForInactivity,
} from "../../utils/inactive-account-deactivation-policy";

export const WORKSPACE_INACTIVE_DEACTIVATED_CODE =
  "WORKSPACE_INACTIVE_DEACTIVATED";
export const WORKSPACE_INACTIVE_DEACTIVATED_MESSAGE =
  "This workspace was deactivated after 30 days without use. Sign in or contact hello@smartrefill.io to keep it.";

const SCAN_PAGE_SIZE = 60;

function inactiveAccountScanCursorRef() {
  return db
    .collection("apps")
    .doc("smartrefill")
    .collection("jobs")
    .doc("inactive_account_scan");
}

export async function resolveOwnerLastActivityAt(
  ownerId: string,
): Promise<Date | null> {
  if (!ownerId) return null;
  const snap = await db
    .collection("users")
    .doc(ownerId)
    .collection("login_events")
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();
  if (!snap.empty) {
    return coerceToDate(snap.docs[0].data().timestamp);
  }
  const byId = await db
    .collection("users")
    .doc(ownerId)
    .collection("login_events")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(1)
    .get();
  if (byId.empty) return null;
  const dayKey = byId.docs[0].id;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return new Date(`${dayKey}T00:00:00.000Z`);
  }
  return coerceToDate(byId.docs[0].data().timestamp);
}

async function sendDeactivationEmail(input: {
  email: string;
  name: string;
  businessName: string;
  loginUrl: string;
}): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: inactive_account_deactivation_email", {
      email: input.email,
    });
    return;
  }
  const tpl = buildInactiveAccountDeactivationEmail({
    ownerName: input.name,
    businessName: input.businessName,
    loginUrl: input.loginUrl,
  });
  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email: input.email, name: input.name }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];
  await api.sendTransacEmail(sendSmtpEmail);
}

export async function deactivateInactiveWorkspace(input: {
  businessId: string;
  businessData: Record<string, unknown>;
  now?: Date;
}): Promise<{ sent: boolean; deactivated: boolean; skipped?: string }> {
  const now = input.now ?? new Date();
  const data = input.businessData;
  if (isWorkspaceInactivityDeactivated(data)) {
    return { sent: false, deactivated: false, skipped: "already_deactivated" };
  }
  const ownerId = String(data.ownerId || "").trim();
  const lastActivityAt = ownerId ?
    await resolveOwnerLastActivityAt(ownerId) :
    null;
  const createdAt = coerceToDate(data.createdAt);
  if (!shouldDeactivateForInactivity({
    lastActivityAt,
    createdAt,
    alreadyDeactivated: false,
    now,
  })) {
    return { sent: false, deactivated: false, skipped: "still_active" };
  }

  const recipient = await resolveOwnerEmailForBusiness(data);
  const businessName = String(data.name || "your Smart Refill workspace");
  const loginUrl = `${resolveAppBaseUrlForEmail()}/login`;
  if (recipient) {
    await sendDeactivationEmail({
      email: recipient.email,
      name: recipient.name,
      businessName,
      loginUrl,
    });
  }

  await db.collection("businesses").doc(input.businessId).set(
    {
      inactivityDeactivatedAt: Timestamp.fromDate(now),
      inactivityReason: "unused_30_days",
      inactivityEmailSentAt: recipient ? Timestamp.fromDate(now) : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { sent: Boolean(recipient), deactivated: true };
}

export async function reactivateWorkspaceAfterInactivity(
  businessId: string,
): Promise<void> {
  await db.collection("businesses").doc(businessId).set(
    {
      inactivityDeactivatedAt: FieldValue.delete(),
      inactivityReason: FieldValue.delete(),
      inactivityEmailSentAt: FieldValue.delete(),
      inactivityReactivatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function runInactiveAccountDeactivationScan(
  now = new Date(),
): Promise<{ scanned: number; deactivated: number; emailed: number }> {
  const cursorRef = inactiveAccountScanCursorRef();
  const cursorSnap = await cursorRef.get();
  const lastId = String(cursorSnap.data()?.lastId || "");
  let query = db
    .collection("businesses")
    .orderBy(FieldPath.documentId())
    .limit(SCAN_PAGE_SIZE);
  if (lastId) {
    query = query.startAfter(lastId);
  }
  const page = await query.get();
  if (page.empty) {
    await cursorRef.set(
      { lastId: "", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { scanned: 0, deactivated: 0, emailed: 0 };
  }

  let deactivated = 0;
  let emailed = 0;
  for (const doc of page.docs) {
    try {
      const result = await deactivateInactiveWorkspace({
        businessId: doc.id,
        businessData: doc.data() ?? {},
        now,
      });
      if (result.deactivated) deactivated += 1;
      if (result.sent) emailed += 1;
    } catch (error) {
      logger.error("inactive account deactivation failed", {
        businessId: doc.id,
        error,
      });
    }
  }

  const nextId = page.docs[page.docs.length - 1]?.id || "";
  await cursorRef.set(
    { lastId: nextId, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  logger.info("inactive account deactivation scan page", {
    scanned: page.size,
    deactivated,
    emailed,
    nextId,
  });
  return { scanned: page.size, deactivated, emailed };
}
