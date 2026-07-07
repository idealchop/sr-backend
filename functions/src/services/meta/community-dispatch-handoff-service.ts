import { db } from "../../config/firebase-admin";
import { normalizeName } from "../ai/name-fuzzy";
import { RawSubmissionService } from "../portal/raw-submission-service";
import type { RawSubmissionPayload } from "../portal/raw-submission-types";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";

type WaterTypeRow = { water?: string; name?: string; price?: number };

function readWaterTypeLabel(row: WaterTypeRow | string): string {
  if (typeof row === "string") return row.trim();
  return String(row.water || row.name || "").trim();
}

async function resolveWaterTypeId(
  businessId: string,
  preferredWaterType?: string,
): Promise<string> {
  const snap = await db.collection("businesses").doc(businessId).get();
  const waterTypes = (snap.data()?.waterTypes ?? []) as Array<WaterTypeRow | string>;
  if (!waterTypes.length) return preferredWaterType?.trim() || "Water";

  const preferred = preferredWaterType?.trim();
  if (preferred) {
    const preferredNorm = normalizeName(preferred);
    for (const row of waterTypes) {
      const label = readWaterTypeLabel(row);
      if (normalizeName(label) === preferredNorm) {
        return label;
      }
    }

    const partial = waterTypes.find((row) => {
      const label = readWaterTypeLabel(row);
      const labelNorm = normalizeName(label);
      return labelNorm.includes(preferredNorm) || preferredNorm.includes(labelNorm);
    });
    if (partial) return readWaterTypeLabel(partial);
  }

  return readWaterTypeLabel(waterTypes[0]) || "Water";
}

async function resolveRefillItems(
  businessId: string,
  fields: CommunityOrderFields,
): Promise<Array<{ type: string; qty: number }>> {
  if (fields.orderLines?.length) {
    const items: Array<{ type: string; qty: number }> = [];
    for (const line of fields.orderLines) {
      const waterTypeId = await resolveWaterTypeId(businessId, line.waterType);
      items.push({
        type: `${waterTypeId} (${line.container})`,
        qty: line.qty,
      });
    }
    return items;
  }

  const waterTypeId = await resolveWaterTypeId(businessId, fields.preferredWaterType);
  return [{ type: waterTypeId, qty: fields.qty ?? 1 }];
}

function buildOrderNotes(referenceId: string | undefined, fields: CommunityOrderFields): string {
  const ref = referenceId?.trim() ?? "";
  const base = `Community Messenger order ${ref}`.trim();
  if (fields.orderRaw?.trim()) {
    return `${base}. Order: ${fields.orderRaw.trim()}`;
  }
  return base;
}

function buildSubmissionPayload(params: {
  fields: CommunityOrderFields;
  request: CommunityDispatchRequestDoc;
  refillItems: Array<{ type: string; qty: number }>;
}): RawSubmissionPayload {
  const { fields, request, refillItems } = params;
  const isDelivery = fields.delivery === true;

  return {
    type: isDelivery ? "delivery" : "collection",
    profile: {
      name: fields.name,
      phone: fields.number,
      ...(fields.email ? { email: fields.email } : {}),
    },
    refillItems,
    ...(isDelivery && fields.location ?
      {
        address: {
          line: fields.location,
          ...(request.geocode ?
            {
              latitude: request.geocode.latitude,
              longitude: request.geocode.longitude,
              formatted: request.geocode.formattedAddress,
            } :
            {}),
        },
      } :
      {}),
    notes: buildOrderNotes(request.referenceId, fields),
    deliveryStatus: "placed",
  };
}

/**
 * CP-14 — create SmartRefill raw_submission when a station accepts a community offer.
 */
export async function createCommunityDispatchSubmission(params: {
  businessId: string;
  requestId: string;
  request: CommunityDispatchRequestDoc;
  acceptedByUid: string;
}): Promise<{ submissionId: string; submissionReferenceId: string }> {
  const fields = params.request.parsed;
  const refillItems = await resolveRefillItems(params.businessId, fields);

  const payload = buildSubmissionPayload({
    fields,
    request: params.request,
    refillItems,
  });

  const created = await RawSubmissionService.createPending(
    params.businessId,
    "",
    "PLACE_ORDER",
    payload,
    { legalAgreed: true },
  );

  await db
    .collection("businesses")
    .doc(params.businessId)
    .collection("raw_submissions")
    .doc(created.id)
    .set(
      {
        metadata: {
          legalAgreed: true,
          portalCustomerStatus: "new",
          portalOrderKind: fields.delivery ? "delivery" : "collection",
          sourceChannel: params.request.sourceChannel ?? "community_messenger",
          communityDispatchRequestId: params.requestId,
          communityReferenceId: params.request.referenceId,
          communityAcceptedByUid: params.acceptedByUid,
        },
      },
      { merge: true },
    );

  return {
    submissionId: created.id,
    submissionReferenceId: created.referenceId,
  };
}
