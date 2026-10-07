import { logger } from "firebase-functions";
import { google } from "googleapis";

import {
  DEMO_ADDITIONAL_INVITEES,
  DEMO_CALENDAR_SCOPES,
  DEMO_PRESENTER_EMAIL,
  DEMO_TIMEZONE,
  demoCalendarImpersonateUser,
} from "./demo-calendar-config";
import { formatDemoSlotLabel, resolveDemoSlot, type DemoSlot } from "./demo-slot";

export type CreateDemoMeetInput = {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  stationCount?: string;
  requestedDate?: string;
  requestedTime?: string;
};

export type CreateDemoMeetResult = {
  slot: DemoSlot;
  slotLabel: string;
  eventId: string | null;
  meetLink: string | null;
};

function normalizePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/\\n/g, "\n");
}

/**
 * Resolve SA credentials used for Calendar domain-wide delegation.
 * Prefers dedicated demo SA JSON secret, then Firebase Admin cert env vars.
 * @return {{ clientEmail: string, privateKey: string } | null} Cert or null.
 */
export function resolveDemoCalendarServiceAccount(): {
  clientEmail: string;
  privateKey: string;
} | null {
  const saJson = process.env.SMARTREFILL_DEMO_CALENDAR_SA_JSON?.trim();
  if (saJson) {
    try {
      const parsed = JSON.parse(saJson) as {
        client_email?: string;
        private_key?: string;
      };
      const clientEmail = parsed.client_email?.trim();
      const privateKey = normalizePrivateKey(parsed.private_key);
      if (clientEmail?.includes("@") && privateKey) {
        return { clientEmail, privateKey };
      }
    } catch (err) {
      logger.warn("SMARTREFILL_DEMO_CALENDAR_SA_JSON parse failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const clientEmail = process.env.SMARTREFILL_FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(
    process.env.SMARTREFILL_FIREBASE_PRIVATE_KEY,
  );
  if (clientEmail?.includes("@") && privateKey) {
    return { clientEmail, privateKey };
  }
  return null;
}

/**
 * Create a 1-hour Google Meet calendar event for a demo request.
 * Soft-fails (returns slot without eventId/meetLink) when DWD/credentials missing.
 * @param {CreateDemoMeetInput} input Lead fields.
 * @return {Promise<CreateDemoMeetResult>} Slot + optional Meet metadata.
 */
export async function createDemoMeetEvent(
  input: CreateDemoMeetInput,
): Promise<CreateDemoMeetResult> {
  const slot = resolveDemoSlot(input.requestedDate, input.requestedTime);
  const slotLabel = formatDemoSlotLabel(slot);

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: Skipping Google Calendar demo Meet create", {
      slotLabel,
      businessName: input.businessName,
    });
    return { slot, slotLabel, eventId: null, meetLink: null };
  }

  const sa = resolveDemoCalendarServiceAccount();
  if (!sa) {
    logger.warn(
      "Demo Meet skipped: set SMARTREFILL_DEMO_CALENDAR_SA_JSON or " +
        "SMARTREFILL_FIREBASE_CLIENT_EMAIL + SMARTREFILL_FIREBASE_PRIVATE_KEY " +
        "(with Workspace domain-wide delegation for Calendar scopes)",
    );
    return { slot, slotLabel, eventId: null, meetLink: null };
  }

  const subject = demoCalendarImpersonateUser();
  const inquireeEmail = input.email.trim().toLowerCase();

  try {
    const auth = new google.auth.JWT({
      email: sa.clientEmail,
      key: sa.privateKey,
      scopes: [...DEMO_CALENDAR_SCOPES],
      subject,
    });

    const calendar = google.calendar({ version: "v3", auth });
    const attendeeEmails = [
      inquireeEmail,
      DEMO_PRESENTER_EMAIL,
      ...DEMO_ADDITIONAL_INVITEES,
    ].filter((e, i, arr) => e.includes("@") && arr.indexOf(e) === i);

    const descriptionLines = [
      `Prospect: ${input.name.trim()}`,
      `Email: ${inquireeEmail}`,
      `Phone: ${input.phone.trim()}`,
      `Business: ${input.businessName.trim()}`,
      input.stationCount?.trim() ?
        `Stations: ${input.stationCount.trim()}` :
        null,
      `Preferred date (form): ${input.requestedDate?.trim() || "—"}`,
      `Preferred time (form): ${input.requestedTime?.trim() || "—"}`,
      `Scheduled slot: ${slotLabel}`,
    ].filter(Boolean);

    const requestId = `sr-demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const inserted = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: `Smart Refill Demo — ${input.businessName.trim() || "WRS"}`,
        description: descriptionLines.join("\n"),
        start: {
          dateTime: slot.startsAtIso,
          timeZone: DEMO_TIMEZONE,
        },
        end: {
          dateTime: slot.endsAtIso,
          timeZone: DEMO_TIMEZONE,
        },
        attendees: attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    const eventId = inserted.data.id ?? null;
    const meetLink =
      inserted.data.hangoutLink?.trim() ||
      inserted.data.conferenceData?.entryPoints?.find(
        (ep) => ep.entryPointType === "video",
      )?.uri?.trim() ||
      null;

    logger.info("Demo Google Meet calendar event created", {
      eventId,
      meetLink,
      slotLabel,
    });

    return { slot, slotLabel, eventId, meetLink };
  } catch (err) {
    logger.error("Demo Google Meet calendar create failed", {
      message: err instanceof Error ? err.message : String(err),
      subject,
    });
    return { slot, slotLabel, eventId: null, meetLink: null };
  }
}
