import {
  DEMO_ADDITIONAL_INVITEES,
  DEMO_PRESENTER_EMAIL,
} from "./demo-calendar-config";
import type { DemoSlot } from "./demo-slot";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC stamp for ICS: YYYYMMDDTHHMMSSZ */
export function toIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export type DemoIcsInput = {
  uid: string;
  slot: DemoSlot;
  businessName: string;
  inquireeName: string;
  inquireeEmail: string;
  meetLink?: string | null;
  descriptionExtra?: string;
};

/**
 * Build a METHOD:REQUEST ICS for the 1-hour demo (Brevo attachment).
 * @param {DemoIcsInput} input Event fields.
 * @return {string} ICS document body.
 */
export function buildDemoRequestIcs(input: DemoIcsInput): string {
  const now = toIcsUtc(new Date());
  const dtStart = toIcsUtc(input.slot.startsAt);
  const dtEnd = toIcsUtc(input.slot.endsAt);
  const summary = escapeIcsText(
    `Smart Refill Demo — ${input.businessName.trim() || "WRS"}`,
  );
  const meet = input.meetLink?.trim() || "";
  const descriptionParts = [
    `Demo with ${input.inquireeName.trim() || "prospect"} (${input.inquireeEmail}).`,
    input.descriptionExtra?.trim() || "",
    meet ? `Google Meet: ${meet}` : "Google Meet link will follow from Smart Refill support.",
  ].filter(Boolean);
  const description = escapeIcsText(descriptionParts.join("\n"));
  const location = meet ? escapeIcsText(meet) : "";

  const attendeeEmails = [
    input.inquireeEmail.trim().toLowerCase(),
    DEMO_PRESENTER_EMAIL,
    ...DEMO_ADDITIONAL_INVITEES,
  ].filter((e, i, arr) => e.includes("@") && arr.indexOf(e) === i);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SmartRefill//Request Demo//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=Smart Refill Support:mailto:${DEMO_PRESENTER_EMAIL}`,
  ];
  if (location) lines.push(`LOCATION:${location}`);
  for (const email of attendeeEmails) {
    const role =
      email === DEMO_PRESENTER_EMAIL ? "CHAIR" : "REQ-PARTICIPANT";
    lines.push(
      `ATTENDEE;CN=${escapeIcsText(email)};ROLE=${role};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`,
    );
  }
  lines.push("STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
