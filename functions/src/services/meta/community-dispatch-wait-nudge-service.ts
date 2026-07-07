import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  buildCommunityWaitNudgeMessage,
  COMMUNITY_WAIT_NUDGE_AFTER_MINUTES,
} from "./community-messenger-customer-notifier";
import { readCommunityCustomerContact } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";

const REQUESTS_COLLECTION = "community_dispatch_requests";

function readTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const maybe = value as { toMillis?: () => number };
  return typeof maybe.toMillis === "function" ? maybe.toMillis() : 0;
}

/** Gentle reminder ~2 min after stations were notified — before radius expand. */
export async function sendCommunityWaitNudgesIfDue(limit = 25): Promise<number> {
  const snap = await db
    .collection(REQUESTS_COLLECTION)
    .where("status", "==", "offered")
    .limit(limit)
    .get();

  const now = Date.now();
  const nudgeAfterMs = COMMUNITY_WAIT_NUDGE_AFTER_MINUTES * 60 * 1000;
  let sent = 0;

  for (const doc of snap.docs) {
    const row = doc.data() as CommunityDispatchRequestDoc;
    if (row.smartrefillSubmissionId || row.waitNudgeSentAt) continue;

    const updatedMs = readTimestampMs(row.updatedAt);
    if (!updatedMs || now - updatedMs < nudgeAfterMs) continue;
    if (now - updatedMs > 15 * 60 * 1000) continue;

    const contact = readCommunityCustomerContact(row);
    if (!contact) continue;

    const referenceId = row.referenceId ?? doc.id;
    const result = await sendCommunityChannelText(
      contact,
      buildCommunityWaitNudgeMessage(referenceId),
    );
    if (!result.ok) {
      logger.warn("sendCommunityWaitNudgesIfDue send_failed", {
        requestId: doc.id,
        reason: result.reason,
      });
      continue;
    }

    await doc.ref.set(
      { waitNudgeSentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    sent += 1;
  }

  return sent;
}
