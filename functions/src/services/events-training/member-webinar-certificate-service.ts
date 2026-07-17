import { auth, db, FieldValue } from "../../config/firebase-admin";
import {
  webinarRegistrationsCollection,
  webinarsCollection,
  trainingVideosCollection,
} from "./events-training-collections";
import { hasVideoUnlock } from "./member-video-unlock-service";
import {
  buildWebinarCertificatePdf,
  webinarCertificateFilename,
} from "./webinar-certificate-pdf";

export function webinarCertificatesCollection(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("webinar_certificates");
}

export async function listClaimedWebinarCertificateIds(
  businessId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!businessId) return set;
  const snap = await webinarCertificatesCollection(businessId).limit(200).get();
  for (const doc of snap.docs) {
    if (String(doc.data()?.status || "issued") === "issued") {
      set.add(doc.id);
    }
  }
  return set;
}

async function memberAttendedLive(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const snap = await webinarRegistrationsCollection()
    .where("eventId", "==", eventId)
    .where("userId", "==", userId)
    .limit(5)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    if (String(data.status || "") !== "accepted") continue;
    if (String(data.attendanceStatus || "") === "attended") return true;
  }
  return false;
}

async function memberWatchedLinkedRecording(
  linkedVideoId: string,
  userId: string,
): Promise<boolean> {
  if (!linkedVideoId) return false;
  const viewSnap = await db
    .collection("apps")
    .doc("smartrefill")
    .collection("training_video_engagement")
    .doc(linkedVideoId)
    .collection("views")
    .doc(userId)
    .get();
  return viewSnap.exists;
}

/**
 * Idempotent certificate claim after live attendance or linked recording watch.
 */
export async function claimWebinarCertificate(input: {
  eventId: string;
  businessId: string;
  userId: string;
}): Promise<{
  eventId: string;
  alreadyClaimed: boolean;
  certificateId: string;
  title: string;
  speaker: string;
  eventStartsAt: string | null;
  issuedAt: string;
  basis: "live_attendance" | "recording_watch";
}> {
  const eventId = input.eventId.trim();
  const businessId = input.businessId.trim();
  const userId = input.userId.trim();
  if (!eventId || !businessId || !userId) {
    throw Object.assign(new Error("Claim input required."), { status: 400 });
  }

  const eventSnap = await webinarsCollection().doc(eventId).get();
  if (!eventSnap.exists) {
    throw Object.assign(new Error("Webinar not found."), { status: 404 });
  }
  const eventData = eventSnap.data() ?? {};
  if (eventData.certificationEnabled !== true) {
    throw Object.assign(
      new Error("This webinar does not offer a certificate."),
      { status: 403, code: "CERTIFICATE_NOT_OFFERED" },
    );
  }
  const title = String(eventData.name || "").trim() || "Webinar certificate";
  const speaker = String(eventData.speaker || "").trim();
  const startsAtRaw = eventData.startsAt;
  const eventStartsAt =
    startsAtRaw &&
    typeof startsAtRaw === "object" &&
    startsAtRaw !== null &&
    "toDate" in startsAtRaw &&
    typeof (startsAtRaw as { toDate?: unknown }).toDate === "function" ?
      (startsAtRaw as { toDate: () => Date }).toDate().toISOString() :
      typeof startsAtRaw === "string" ?
        startsAtRaw :
        null;
  const linkedVideoId =
    typeof eventData.linkedVideoId === "string" ? eventData.linkedVideoId : "";

  const certRef = webinarCertificatesCollection(businessId).doc(eventId);
  const existing = await certRef.get();
  if (existing.exists && String(existing.data()?.status || "issued") === "issued") {
    const data = existing.data() ?? {};
    return {
      eventId,
      alreadyClaimed: true,
      certificateId: eventId,
      title: String(data.title || title),
      speaker: String(data.speaker || speaker),
      eventStartsAt:
        typeof data.eventStartsAt === "string" ?
          data.eventStartsAt :
          eventStartsAt,
      issuedAt:
        data.issuedAt &&
        typeof data.issuedAt === "object" &&
        data.issuedAt !== null &&
        "toDate" in data.issuedAt &&
        typeof (data.issuedAt as { toDate?: unknown }).toDate === "function" ?
          (data.issuedAt as { toDate: () => Date }).toDate().toISOString() :
          new Date().toISOString(),
      basis:
        data.basis === "recording_watch" ? "recording_watch" : "live_attendance",
    };
  }

  const attended = await memberAttendedLive(eventId, userId);
  const watched = await memberWatchedLinkedRecording(linkedVideoId, userId);

  // Premium linked recordings still require unlock before counting as complete.
  if (watched && linkedVideoId) {
    const videoSnap = await trainingVideosCollection().doc(linkedVideoId).get();
    const visibility = String(videoSnap.data()?.visibility || "public");
    if (visibility === "premium") {
      const unlocked = await hasVideoUnlock(businessId, linkedVideoId);
      if (!unlocked) {
        throw Object.assign(
          new Error("Unlock the linked recording before claiming a certificate."),
          { status: 402, code: "PREMIUM_PAYMENT_REQUIRED" },
        );
      }
    }
  }

  if (!attended && !watched) {
    throw Object.assign(
      new Error(
        "Attend the live session (join) or finish the linked recording first.",
      ),
      { status: 403, code: "ATTENDANCE_REQUIRED" },
    );
  }

  const basis = attended ? "live_attendance" : "recording_watch";
  const now = FieldValue.serverTimestamp();
  const issuedAt = new Date().toISOString();
  const { recipientName } = await resolveRecipientName(userId, businessId);

  await certRef.set(
    {
      eventId,
      businessId,
      userId,
      title,
      speaker,
      eventStartsAt,
      recipientName,
      basis,
      status: "issued",
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  await syncTrainingCertificationRecord({
    userId,
    businessId,
    eventId,
    title,
    speaker,
    eventStartsAt,
    recipientName,
    basis,
  }).catch((error) => {
    console.error("syncTrainingCertificationRecord failed", error);
  });

  return {
    eventId,
    alreadyClaimed: false,
    certificateId: eventId,
    title,
    speaker,
    eventStartsAt,
    issuedAt,
    basis,
  };
}

/**
 * Auto-issue when attendance is marked. No-op when the webinar template is off
 * or the member is not yet eligible.
 */
export async function awardWebinarCertificateOnAttendance(input: {
  eventId: string;
  businessId: string;
  userId: string;
}): Promise<void> {
  try {
    await claimWebinarCertificate(input);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ?
        String((error as { code?: unknown }).code || "") :
        "";
    // Expected skips — webinar not offering certs, or edge race before attend write.
    if (
      code === "CERTIFICATE_NOT_OFFERED" ||
      code === "ATTENDANCE_REQUIRED" ||
      code === "PREMIUM_PAYMENT_REQUIRED"
    ) {
      return;
    }
    console.error("awardWebinarCertificateOnAttendance failed", error);
  }
}

async function syncTrainingCertificationRecord(input: {
  userId: string;
  businessId: string;
  eventId: string;
  title: string;
  speaker: string;
  eventStartsAt: string | null;
  recipientName: string;
  basis: "live_attendance" | "recording_watch";
}): Promise<void> {
  const root = db.collection("apps").doc("smartrefill").collection(
    "training_certifications",
  );
  const existing = await root
    .where("userId", "==", input.userId)
    .where("targetId", "==", input.eventId)
    .limit(5)
    .get();
  const active = existing.docs.find(
    (doc) => String(doc.data()?.status || "issued") !== "revoked",
  );
  const now = FieldValue.serverTimestamp();
  const payload = {
    userId: input.userId,
    businessId: input.businessId,
    appId: "smartrefill",
    recipientName: input.recipientName,
    targetType: "webinar_event",
    targetId: input.eventId,
    title: input.title,
    courseName: input.title,
    speaker: input.speaker,
    eventStartsAt: input.eventStartsAt,
    issuedBy: "attendance",
    basis: input.basis,
    status: "issued",
    revokedAt: null,
    updatedAt: now,
  };
  if (active) {
    await active.ref.set(payload, { merge: true });
    return;
  }
  await root.add({
    ...payload,
    certificateUrl: null,
    issuedAt: now,
    createdAt: now,
  });
}

async function resolveRecipientName(
  userId: string,
  businessId: string,
): Promise<{ recipientName: string; businessName: string }> {
  let recipientName = "Station member";
  let businessName = "Water Refilling Station";
  try {
    const user = await auth.getUser(userId);
    const fromAuth = String(user.displayName || "").trim();
    if (fromAuth) recipientName = fromAuth;
  } catch {
    // Fall back to default label.
  }
  const bizSnap = await db.collection("businesses").doc(businessId).get();
  if (bizSnap.exists) {
    const name = String(bizSnap.data()?.name || "").trim();
    if (name) businessName = name;
  }
  return { recipientName, businessName };
}

/**
 * Loads an issued certificate and builds a downloadable/viewable PDF.
 */
export async function getWebinarCertificatePdf(input: {
  eventId: string;
  businessId: string;
  userId: string;
}): Promise<{ buffer: Buffer; filename: string }> {
  const eventId = input.eventId.trim();
  const businessId = input.businessId.trim();
  const userId = input.userId.trim();
  if (!eventId || !businessId || !userId) {
    throw Object.assign(new Error("Certificate lookup input required."), {
      status: 400,
    });
  }

  const certSnap = await webinarCertificatesCollection(businessId).doc(eventId).get();
  if (!certSnap.exists || String(certSnap.data()?.status || "issued") !== "issued") {
    throw Object.assign(new Error("Certificate not found. Claim it first."), {
      status: 404,
      code: "CERTIFICATE_NOT_FOUND",
    });
  }

  const data = certSnap.data() ?? {};
  const ownerUid = String(data.userId || "").trim();
  const title = String(data.title || "").trim() || "Webinar certificate";
  const speaker = String(data.speaker || "").trim();
  const eventStartsAt =
    typeof data.eventStartsAt === "string" ? data.eventStartsAt : null;
  const issuedAt =
    data.issuedAt &&
    typeof data.issuedAt === "object" &&
    data.issuedAt !== null &&
    "toDate" in data.issuedAt &&
    typeof (data.issuedAt as { toDate?: unknown }).toDate === "function" ?
      (data.issuedAt as { toDate: () => Date }).toDate().toISOString() :
      new Date().toISOString();

  const { recipientName } = await resolveRecipientName(
    ownerUid || userId,
    businessId,
  );

  const buffer = await buildWebinarCertificatePdf({
    recipientName,
    title,
    speaker,
    eventStartsAt,
    issuedAt,
    certificateId: eventId,
  });

  return {
    buffer,
    filename: webinarCertificateFilename(title, eventId),
  };
}
