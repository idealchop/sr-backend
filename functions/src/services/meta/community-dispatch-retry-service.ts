import { db } from "../../config/firebase-admin";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import type {
  CommunityDispatchRequestDoc,
  CommunityDispatchRequestStatus,
} from "./community-dispatch-request-types";

const COLLECTION = "community_dispatch_requests";

const RETRYABLE_STATUSES: CommunityDispatchRequestStatus[] = ["needs_location"];

export type PendingCommunityDispatchRequest = {
  id: string;
  doc: CommunityDispatchRequestDoc;
};

/** Latest community request awaiting customer follow-up (address). */
export async function findPendingCommunityDispatchRequest(
  contactId: string,
): Promise<PendingCommunityDispatchRequest | null> {
  let snap = await db
    .collection(COLLECTION)
    .where("channelContactId", "==", contactId)
    .limit(20)
    .get();

  if (snap.empty) {
    snap = await db
      .collection(COLLECTION)
      .where("metaPsid", "==", contactId)
      .limit(20)
      .get();
  }

  if (snap.empty) {
    snap = await db
      .collection(COLLECTION)
      .where("whatsappWaId", "==", contactId)
      .limit(20)
      .get();
  }

  if (snap.empty) {
    snap = await db
      .collection(COLLECTION)
      .where("viberUserId", "==", contactId)
      .limit(20)
      .get();
  }

  const candidates = snap.docs
    .map((doc) => ({
      id: doc.id,
      doc: doc.data() as CommunityDispatchRequestDoc,
    }))
    .filter((row) => RETRYABLE_STATUSES.includes(row.doc.status));

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aMs = readTimestampMs(a.doc.updatedAt);
    const bMs = readTimestampMs(b.doc.updatedAt);
    return bMs - aMs;
  });

  return candidates[0] ?? null;
}

function readTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const maybe = value as { toMillis?: () => number };
  if (typeof maybe.toMillis === "function") {
    return maybe.toMillis();
  }
  return 0;
}

export function mergeCommunityOrderFields(
  base: CommunityOrderFields,
  patch: CommunityOrderFields,
): CommunityOrderFields {
  return {
    ...(base.name ? { name: base.name } : {}),
    ...(base.delivery !== undefined ? { delivery: base.delivery } : {}),
    ...(base.qty !== undefined ? { qty: base.qty } : {}),
    ...(base.preferredWaterType ?
      { preferredWaterType: base.preferredWaterType } :
      {}),
    ...(base.location ? { location: base.location } : {}),
    ...(base.email ? { email: base.email } : {}),
    ...(base.number ? { number: base.number } : {}),
    ...(base.orderRaw ? { orderRaw: base.orderRaw } : {}),
    ...(base.orderLines?.length ? { orderLines: base.orderLines } : {}),
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.delivery !== undefined ? { delivery: patch.delivery } : {}),
    ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
    ...(patch.preferredWaterType ?
      { preferredWaterType: patch.preferredWaterType } :
      {}),
    ...(patch.location ? { location: patch.location } : {}),
    ...(patch.email ? { email: patch.email } : {}),
    ...(patch.number ? { number: patch.number } : {}),
    ...(patch.orderRaw ? { orderRaw: patch.orderRaw } : {}),
    ...(patch.orderLines?.length ? { orderLines: patch.orderLines } : {}),
  };
}

/** Plain-text reply that likely carries a delivery address (not yes/no/hello). */
export function looksLikeAddressFollowUp(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (/^(yes|y|no|n|oo|opo|hindi|hello|hi|help|order|salamat)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

export function buildRetryFieldsFromFollowUp(params: {
  pending: PendingCommunityDispatchRequest;
  text: string;
  templateFields: CommunityOrderFields;
  templateLooksComplete: boolean;
}): CommunityOrderFields | null {
  const { pending, text, templateFields, templateLooksComplete } = params;
  const base = pending.doc.parsed ?? {};

  if (templateLooksComplete) {
    return mergeCommunityOrderFields(base, templateFields);
  }

  if (pending.doc.status === "needs_location") {
    const location =
      templateFields.location?.trim() ||
      (looksLikeAddressFollowUp(text) ? text.trim() : undefined);
    if (!location) return null;
    return mergeCommunityOrderFields(base, { location });
  }

  return null;
}
