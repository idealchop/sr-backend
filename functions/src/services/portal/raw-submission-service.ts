import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { InventoryService } from "../inventory/inventory-service";
import {
  RawSubmission,
  RawSubmissionPayload,
  RawSubmissionStatus,
  RawSubmissionType,
} from "./raw-submission-types";
import { OnlineOrderLimitService } from "./online-order-limit-service";
import { allocateWalkInQueueNumber } from "./walk-in-queue-service";
import { sendNewOrderPushForSubmission } from "../notifications/new-order-push-service";
import {
  notifyPortalRecognizedProfileUpdated,
  notifyPortalSubmissionCreated,
} from "../notifications/station-activity-notification-service";
import { maybeSendPortalOrderReceivedEmail } from "./portal-order-received-notifier";
import { CustomerService } from "../customers/customer-service";
import {
  listPortalProfileChanges,
  resolvePortalCustomerStatus,
  summarizePortalProfileChanges,
} from "./portal-profile-diff";

function col(businessId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("raw_submissions");
}

/**
 * Validates on-hand stock for portal **dispatch** lines (`payload.inventoryItems`) only.
 * Water refills are not gated here (they follow pricing / fulfillment rules elsewhere).
 * @param {string} businessId Business id.
 * @param {RawSubmissionPayload} payload Portal submission payload.
 * @return {{ok: boolean, messages: string[]}} Stock sufficiency summary.
 */
export async function computeStockCheckPreview(
  businessId: string,
  payload: RawSubmissionPayload,
): Promise<{ ok: boolean; messages: string[] }> {
  const messages: string[] = [];

  const dispatch = payload.inventoryItems || [];
  for (const line of dispatch) {
    const id = line.inventoryId;
    const qty = line.qty;
    if (!id || qty <= 0) continue;
    const inv = await InventoryService.getItem(businessId, id);
    if (!inv) {
      messages.push(`Unknown dispatch item ${id} — verify inventory id.`);
      continue;
    }
    const available = inv.stock?.current ?? 0;
    if (available < qty) {
      messages.push(`Dispatch ${inv.name}: need ${qty}, have ${available}.`);
    }
  }

  return { ok: messages.length === 0, messages };
}

function resolvePortalCustomerDisplayName(
  customerName: string | undefined,
  payload: RawSubmissionPayload,
): string {
  const fromCustomer = (customerName || "").trim();
  if (fromCustomer) return fromCustomer;
  const profile = payload.profile;
  const fromProfileName = String(profile?.name || "").trim();
  if (fromProfileName) return fromProfileName;
  const fromParts = [profile?.firstName, profile?.lastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  if (fromParts) return fromParts;
  return "Customer";
}

export class RawSubmissionService {
  static async createPending(
    businessId: string,
    customerId: string,
    submissionType: RawSubmissionType,
    payload: RawSubmissionPayload,
    opts: {
      legalAgreed: boolean;
      userAgent?: string;
    },
  ): Promise<{ id: string; referenceId: string; walkInQueueNumber?: number }> {
    if (!opts.legalAgreed) {
      throw new Error("LEGAL_REQUIRED");
    }
    let overOnlineOrderLimit = false;
    if (
      submissionType === "PLACE_ORDER" ||
      submissionType === "REQUEST_COLLECTION"
    ) {
      overOnlineOrderLimit =
        await OnlineOrderLimitService.willCreateBeyondOnlineOrderLimit(
          businessId,
        );
    }
    const stockCheckPreview =
      submissionType === "PLACE_ORDER" ?
        await computeStockCheckPreview(businessId, payload) :
        { ok: true, messages: [] };

    const now = new Date();
    const datePart = now.toISOString().slice(2, 10).replace(/-/g, ""); // YYMMDD
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const referenceId =
      submissionType === "MARK_TX_COMPLETE" ?
        `MC-${datePart}-${random}` :
        submissionType === "PORTAL_PAY_BALANCE" ?
          `PB-${datePart}-${random}` :
          `TX-${datePart}-${random}`;

    let transactionType: RawSubmission["transactionType"] | undefined;
    if (submissionType === "REQUEST_COLLECTION") {
      transactionType = "collection";
    } else if (submissionType === "PLACE_ORDER") {
      const fromPayload = payload.type;
      if (fromPayload === "walkin") {
        transactionType = undefined;
      } else {
        transactionType =
          fromPayload === "delivery" || fromPayload === "collection" ?
            fromPayload :
            "delivery";
      }
    } else if (submissionType === "PORTAL_PAY_BALANCE") {
      transactionType = "delivery";
    } else if (submissionType === "MARK_TX_COMPLETE") {
      const fromPayload = payload.type;
      if (fromPayload === "delivery" || fromPayload === "collection") {
        transactionType = fromPayload;
      }
    }

    const portalOrderKind =
      submissionType === "PLACE_ORDER" && payload.type === "walkin" ?
        "walkin" :
        transactionType === "delivery" || transactionType === "collection" ?
          transactionType :
          undefined;

    let walkInQueueNumber: number | undefined;
    let walkInQueueDate: string | undefined;
    if (submissionType === "PLACE_ORDER" && payload.type === "walkin") {
      const allocated = await allocateWalkInQueueNumber(businessId, now);
      walkInQueueNumber = allocated.queueNumber;
      walkInQueueDate = allocated.queueDate;
    }

    const doc: Omit<RawSubmission, "id"> = {
      businessId,
      customerId,
      referenceId,
      submissionType,
      ...(transactionType ? { transactionType } : {}),
      status: "pending_review",
      payload,
      metadata: {
        legalAgreed: true,
        submittedAt: FieldValue.serverTimestamp(),
        userAgent: opts.userAgent,
        ...(overOnlineOrderLimit ? { overOnlineOrderLimit: true } : {}),
        ...(portalOrderKind ? { portalOrderKind } : {}),
        ...(walkInQueueNumber != null ?
          { walkInQueueNumber, walkInQueueDate } :
          {}),
        portalCustomerStatus: resolvePortalCustomerStatus(customerId),
      },
      submittedAt: FieldValue.serverTimestamp(),
      stockCheckPreview,
    };

    const ref = await col(businessId).add(doc);
    logger.info("raw_submission created", {
      businessId,
      customerId,
      submissionType,
      id: ref.id,
      referenceId,
    });

    void sendNewOrderPushForSubmission(businessId, {
      submissionId: ref.id,
      submissionType,
      customerId,
      referenceId,
      portalOrderKind,
    }).catch((err) => {
      logger.warn("new_order push failed", {
        businessId,
        submissionId: ref.id,
        error: err,
      });
    });

    void (async () => {
      try {
        const portalCustomerStatus = resolvePortalCustomerStatus(customerId);
        const customer =
          customerId ?
            await CustomerService.getCustomer(businessId, customerId) :
            null;
        const customerName = resolvePortalCustomerDisplayName(
          customer?.name,
          payload,
        );
        await notifyPortalSubmissionCreated(businessId, {
          submissionId: ref.id,
          submissionType,
          customerId,
          customerName,
          referenceId,
          portalOrderKind,
          portalCustomerStatus,
        });

        if (portalCustomerStatus === "recognized" && customer) {
          const changedFields = listPortalProfileChanges(customer, payload);
          const changedSummary = summarizePortalProfileChanges(changedFields);
          if (changedSummary) {
            await notifyPortalRecognizedProfileUpdated(businessId, {
              submissionId: ref.id,
              customerId,
              customerName,
              referenceId,
              changedSummary,
            });
          }
        }
      } catch (err) {
        logger.warn("portal activity notification failed", {
          businessId,
          submissionId: ref.id,
          error: err,
        });
      }
    })();

    void maybeSendPortalOrderReceivedEmail({
      businessId,
      customerId,
      submissionType,
      referenceId,
      payload,
    }).catch((err) => {
      logger.warn("portal order received email failed", {
        businessId,
        submissionId: ref.id,
        error: err,
      });
    });

    return { id: ref.id, referenceId, walkInQueueNumber };
  }

  static async listByStatus(
    businessId: string,
    status: RawSubmissionStatus,
    limit = 50,
  ): Promise<RawSubmission[]> {
    const snap = await col(businessId)
      .where("status", "==", status)
      .orderBy("submittedAt", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RawSubmission);
  }

  static async getOne(
    businessId: string,
    submissionId: string,
  ): Promise<RawSubmission | null> {
    const doc = await col(businessId).doc(submissionId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as RawSubmission;
  }

  static async updateStatus(
    businessId: string,
    submissionId: string,
    patch: Partial<RawSubmission>,
  ): Promise<void> {
    await col(businessId)
      .doc(submissionId)
      .update({
        ...patch,
      });
  }

  /**
   * Dot-path update so existing metadata fields are preserved.
   * @param {string} businessId The ID of the business
   * @param {string} submissionId The ID of the submission
   */
  static async markProfileMergedToCustomer(
    businessId: string,
    submissionId: string,
  ): Promise<void> {
    await col(businessId).doc(submissionId).update({
      "metadata.profileMergedAt": FieldValue.serverTimestamp(),
    });
  }

  /**
   * When staff registers a new suki from the portal (register-new-suki) or accept() creates
   * a customer in one step. Used for track-order customer-facing copy.
   * @param {string} businessId The ID of the business
   * @param {string} submissionId The ID of the submission
   */
  static async markCustomerRegisteredFromPortal(
    businessId: string,
    submissionId: string,
  ): Promise<void> {
    await col(businessId).doc(submissionId).update({
      "metadata.customerRegisteredAt": FieldValue.serverTimestamp(),
    });
  }

  /**
   * First raw_submission whose top-level `referenceId` matches
   * (e.g. same as transaction.referenceId).
   * @param {string} businessId
   * @param {string} referenceId
   * @return {Promise<RawSubmission | null>}
   */
  static async findFirstByReferenceId(
    businessId: string,
    referenceId: string,
  ): Promise<RawSubmission | null> {
    const rid = (referenceId || "").trim();
    if (!rid) return null;
    const snap = await col(businessId)
      .where("referenceId", "==", rid)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as RawSubmission;
  }
}
