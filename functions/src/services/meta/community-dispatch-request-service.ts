import { createHash } from "crypto";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import {
  channelContactFields,
  type CommunityChannelContact,
} from "./community-channel-contact";
import {
  formatCommunityRequestReference,
  type CommunityDispatchParseSource,
  type CommunityDispatchRequestDoc,
  type CreateCommunityDispatchRequestResult,
} from "./community-dispatch-request-types";

const COLLECTION = "community_dispatch_requests";

function sanitizeDocId(metaMessageId: string): string {
  return metaMessageId.replace(/\//g, "_").slice(0, 500);
}

/** Stable id when Meta `mid` is absent (rare). */
export function buildFallbackMetaMessageId(psid: string, rawMessage: string): string {
  const digest = createHash("sha256")
    .update(`${psid}\n${rawMessage.trim()}`)
    .digest("hex")
    .slice(0, 32);
  return `hash_${digest}`;
}

function serializeParsed(fields: CommunityOrderFields): CommunityOrderFields {
  return {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.delivery !== undefined ? { delivery: fields.delivery } : {}),
    ...(fields.qty !== undefined ? { qty: fields.qty } : {}),
    ...(fields.preferredWaterType ?
      { preferredWaterType: fields.preferredWaterType } :
      {}),
    ...(fields.location ? { location: fields.location } : {}),
    ...(fields.email ? { email: fields.email } : {}),
    ...(fields.number ? { number: fields.number } : {}),
    ...(fields.orderRaw ? { orderRaw: fields.orderRaw } : {}),
    ...(fields.orderLines?.length ? { orderLines: fields.orderLines } : {}),
  };
}

/**
 * CP-05 — persist parsed community intake; idempotent on Meta message id.
 */
export async function createCommunityDispatchRequest(params: {
  contact: CommunityChannelContact;
  metaMessageId: string;
  rawMessage: string;
  fields: CommunityOrderFields;
  parseSource: CommunityDispatchParseSource;
}): Promise<CreateCommunityDispatchRequestResult> {
  const docId = sanitizeDocId(params.metaMessageId.trim());
  const ref = db.collection(COLLECTION).doc(docId);
  const referenceId = formatCommunityRequestReference(docId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const data = existing.data() as CommunityDispatchRequestDoc | undefined;
      return {
        id: docId,
        referenceId: data?.referenceId ?? referenceId,
        created: false,
      };
    }

    const doc: CommunityDispatchRequestDoc = {
      status: "parsed",
      ...channelContactFields(params.contact),
      metaMessageId: params.metaMessageId,
      rawMessage: params.rawMessage.slice(0, 4000),
      parsed: serializeParsed(params.fields),
      parseSource: params.parseSource,
      referenceId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(ref, doc);
    return { id: docId, referenceId, created: true };
  });
}

/** Merge follow-up customer text into an existing dispatch request before re-routing. */
export async function appendCommunityDispatchRequestFollowUp(params: {
  requestId: string;
  fields: CommunityOrderFields;
  followUpMessage: string;
}): Promise<void> {
  const ref = db.collection(COLLECTION).doc(params.requestId);
  const snap = await ref.get();
  const existingRaw =
    typeof snap.data()?.rawMessage === "string" ? snap.data()?.rawMessage : "";

  await ref.set(
    {
      parsed: serializeParsed(params.fields),
      rawMessage: `${existingRaw}\n---\n${params.followUpMessage.trim()}`.slice(0, 4000),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function persistValidatedCommunityOrder(params: {
  contact: CommunityChannelContact;
  metaMessageId: string;
  rawMessage: string;
  fields: CommunityOrderFields;
  parseSource: CommunityDispatchParseSource;
}): Promise<CreateCommunityDispatchRequestResult> {
  try {
    const result = await createCommunityDispatchRequest(params);
    logger.info("communityDispatchRequest persisted", {
      id: result.id,
      referenceId: result.referenceId,
      created: result.created,
      parseSource: params.parseSource,
    });
    return result;
  } catch (error) {
    logger.error("communityDispatchRequest persist failed", error);
    throw error;
  }
}
