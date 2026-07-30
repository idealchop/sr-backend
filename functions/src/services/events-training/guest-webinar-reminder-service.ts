import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { resolveMarketingSiteBaseUrl } from "../../utils/app-base-url";
import { buildGuestWebinarReminderEmail } from "../../utils/guest-webinar-invite-email-template";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  hashJoinToken,
  mintJoinToken,
} from "./guest-webinar-registration-service";
import { isCmsGuestRegistrationAllowed } from "./guest-webinar-eligibility";

/** Reminder window: startsAt between now+45m and now+75m. */
export const REMINDER_WINDOW_MIN_MS = 45 * 60 * 1000;
export const REMINDER_WINDOW_MAX_MS = 75 * 60 * 1000;

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function formatStartsAtLabel(startsAt: string | null, timeZone: string): string {
  if (!startsAt) return "Schedule TBD";
  try {
    return new Date(startsAt).toLocaleString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || "Asia/Manila",
    });
  } catch {
    return startsAt;
  }
}

export function isWithinGuestReminderWindow(
  startsAtIso: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!startsAtIso) return false;
  const start = Date.parse(startsAtIso);
  if (Number.isNaN(start)) return false;
  const delta = start - nowMs;
  return delta >= REMINDER_WINDOW_MIN_MS && delta <= REMINDER_WINDOW_MAX_MS;
}

async function sendReminderEmail(params: {
  email: string;
  displayName: string;
  eventName: string;
  startsAt: string | null;
  timezone: string;
  joinToken: string;
}): Promise<void> {
  const joinUrl =
    `${resolveMarketingSiteBaseUrl()}/resources/webinars/join?t=${encodeURIComponent(params.joinToken)}`;
  const cancelUrl =
    `${resolveMarketingSiteBaseUrl()}/resources/webinars/cancel?t=${encodeURIComponent(params.joinToken)}`;
  const timezone = params.timezone.trim() || "Asia/Manila";
  const tpl = buildGuestWebinarReminderEmail({
    displayName: params.displayName,
    eventName: params.eventName,
    startsAtLabel: formatStartsAtLabel(params.startsAt, timezone),
    timezone,
    joinUrl,
    cancelUrl,
  });

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: guest webinar reminder email", {
      email: params.email,
      subject: tpl.subject,
      joinUrl,
    });
    return;
  }

  const api = getBrevoApi();
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = { name: "Smart Refill", email: "no-reply@smartrefill.io" };
  sendSmtpEmail.to = [{ email: params.email, name: params.displayName || params.email }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = [tpl.brevoTag];
  await api.sendTransacEmail(sendSmtpEmail);
}

/**
 * Sends T-~1h reminders for opted-in guest registrations on upcoming published events.
 */
export async function sendDueGuestWebinarReminders(limit = 40): Promise<{
  eventsScanned: number;
  remindersSent: number;
  skipped: number;
}> {
  const nowMs = Date.now();
  const eventsSnap = await webinarsCollection().limit(100).get();
  let eventsScanned = 0;
  let remindersSent = 0;
  let skipped = 0;

  for (const eventDoc of eventsSnap.docs) {
    if (remindersSent >= limit) break;
    const eventData = (eventDoc.data() ?? {}) as Record<string, unknown>;
    if (String(eventData.status || "") !== "published") continue;
    if (!isCmsGuestRegistrationAllowed(eventData)) continue;

    const startsAt = toIso(eventData.startsAt);
    if (!isWithinGuestReminderWindow(startsAt, nowMs)) continue;
    eventsScanned += 1;

    const regsSnap = await webinarRegistrationsCollection()
      .where("eventId", "==", eventDoc.id)
      .where("kind", "==", "guest")
      .limit(80)
      .get()
      .catch(async () => {
        // Fallback without composite index: filter kind in memory.
        const all = await webinarRegistrationsCollection()
          .where("eventId", "==", eventDoc.id)
          .limit(120)
          .get();
        return {
          docs: all.docs.filter((d) => String(d.data()?.kind || "") === "guest"),
        };
      });

    for (const regDoc of regsSnap.docs) {
      if (remindersSent >= limit) break;
      const reg = (regDoc.data() ?? {}) as Record<string, unknown>;
      const status = String(reg.status || "");
      if (status !== "accepted" && status !== "pending") {
        skipped += 1;
        continue;
      }
      if (reg.emailReminderOptIn === false) {
        skipped += 1;
        continue;
      }
      if (reg.reminderSentAt) {
        skipped += 1;
        continue;
      }

      const email = String(reg.email || "").trim().toLowerCase();
      if (!email) {
        skipped += 1;
        continue;
      }

      const joinToken = mintJoinToken();
      try {
        await sendReminderEmail({
          email,
          displayName: String(reg.displayName || "").trim() || email,
          eventName: String(eventData.name || "").trim() || "Smart Refill webinar",
          startsAt,
          timezone:
            typeof eventData.timezone === "string" ?
              eventData.timezone :
              "Asia/Manila",
          joinToken,
        });
        await webinarRegistrationsCollection().doc(regDoc.id).set(
          {
            joinTokenHash: hashJoinToken(joinToken),
            joinTokenCreatedAt: FieldValue.serverTimestamp(),
            reminderSentAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        remindersSent += 1;
      } catch (error) {
        logger.error("guest webinar reminder failed", {
          registrationId: regDoc.id,
          error,
        });
        skipped += 1;
      }
    }
  }

  return { eventsScanned, remindersSent, skipped };
}
