import { FieldValue } from "firebase-admin/firestore";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
} from "./events-training-collections";
import {
  guestRegistrationDocId,
  isValidGuestEmail,
  normalizeGuestEmail,
} from "./guest-webinar-registration-service";
import {
  guestUnlockDocId,
  guestWebinarCertificatesCollection,
  hasGuestWebinarUnlock,
} from "./guest-webinar-unlock-service";
import {
  buildWebinarCertificatePdf,
  webinarCertificateFilename,
} from "./webinar-certificate-pdf";
import { toIsoTimestamp } from "./webinar-registration-window";

/**
 * Paid guests may claim a certificate after attendance (no SmartRefill account).
 */
export async function claimGuestWebinarCertificate(input: {
  eventId: string;
  email: string;
}): Promise<{
  alreadyClaimed: boolean;
  certificateId: string;
  filename: string;
  pdfBase64: string;
  title: string;
}> {
  const eventId = String(input.eventId || "").trim();
  const email = normalizeGuestEmail(input.email);
  if (!eventId || !isValidGuestEmail(email)) {
    throw Object.assign(new Error("eventId and a valid email are required."), {
      status: 400,
      code: "INVALID_INPUT",
    });
  }

  if (!(await hasGuestWebinarUnlock(eventId, email))) {
    throw Object.assign(
      new Error("Premium unlock required before claiming a guest certificate."),
      { status: 403, code: "NOT_UNLOCKED" },
    );
  }

  const eventSnap = await webinarsCollection().doc(eventId).get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("Webinar not found."), {
      status: 404,
      code: "EVENT_NOT_FOUND",
    });
  }
  const eventData = (eventSnap.data() ?? {}) as Record<string, unknown>;
  if (eventData.certificationEnabled !== true) {
    throw Object.assign(new Error("This webinar does not offer a certificate."), {
      status: 409,
      code: "CERT_DISABLED",
    });
  }

  const regId = guestRegistrationDocId(eventId, email);
  const regSnap = await webinarRegistrationsCollection().doc(regId).get();
  const reg = (regSnap.data() ?? {}) as Record<string, unknown>;
  if (String(reg.attendanceStatus || "") !== "attended") {
    throw Object.assign(
      new Error("Join the live session first to claim your certificate."),
      { status: 403, code: "NOT_ATTENDED" },
    );
  }

  const certificateId = guestUnlockDocId(eventId, email);
  const certRef = guestWebinarCertificatesCollection().doc(certificateId);
  const existing = await certRef.get();
  const title = String(eventData.name ?? "").trim() || "Smart Refill webinar";
  const speaker = String(eventData.speaker ?? "").trim();
  const recipientName =
    String(reg.displayName || "").trim() || email.split("@")[0] || email;
  const eventStartsAt = toIsoTimestamp(eventData.startsAt);

  if (existing.exists && String(existing.data()?.status || "") === "issued") {
    const pdf = await buildWebinarCertificatePdf({
      recipientName,
      title,
      speaker,
      eventStartsAt,
      issuedAt: toIsoTimestamp(existing.data()?.issuedAt) || new Date().toISOString(),
      certificateId,
    });
    return {
      alreadyClaimed: true,
      certificateId,
      filename: webinarCertificateFilename(title, eventId),
      pdfBase64: pdf.toString("base64"),
      title,
    };
  }

  const issuedAt = new Date().toISOString();
  const pdf = await buildWebinarCertificatePdf({
    recipientName,
    title,
    speaker,
    eventStartsAt,
    issuedAt,
    certificateId,
  });

  await certRef.set(
    {
      eventId,
      email,
      recipientName,
      title,
      speaker,
      status: "issued",
      issuedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    alreadyClaimed: false,
    certificateId,
    filename: webinarCertificateFilename(title, eventId),
    pdfBase64: pdf.toString("base64"),
    title,
  };
}
