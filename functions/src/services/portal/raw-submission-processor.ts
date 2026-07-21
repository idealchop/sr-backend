import { db, FieldValue } from "../../config/firebase-admin";
import { CustomerActiveLimitService } from "../customers/customer-active-limit-service";
import { CustomerService } from "../customers/customer-service";
import {
  getBusinessContainerDefaultPolicy,
} from "../customers/container-policy";
import { ensureCustomerActiveForPortalAcceptance } from "./portal-customer-activation";
import { InventoryService } from "../inventory/inventory-service";
import { logger } from "../observability/logging/logger";
import { TransactionService } from "../transactions/transaction-service";
import { derivePaymentFields } from "../transactions/payment-status";
import {
  applyPortalCompletionTransactionPatch,
  buildPortalCompletionTransactionUpdates,
  resolvePortalCompletionTransaction,
} from "./portal-transaction-completion";
import {
  assertPortalAdvancePaymentFullAmount,
  buildPortalBalancePaymentUpdates,
  maybeDeleteRawSubmissionsAfterPaidComplete,
  maybeSendAdvancePaymentReceiptEmail,
  resolvePortalBalancePaymentTransaction,
} from "./portal-balance-payment";
import { RawSubmissionService } from "./raw-submission-service";
import {
  mergePortalProfileFromSubmission,
  maybeNotifyPortalCompletionReceipt,
} from "./portal-completion-receipt-notifier";
import { RawSubmission } from "./raw-submission-types";
import {
  resolvePortalCustomerStatus,
  type PortalCustomerStatus,
} from "./portal-profile-diff";
import { notifyPortalSubmissionFulfilled } from "../notifications/station-activity-notification-service";

const DEFAULT_WATER_PRICE = 30;

function resolvePortalCustomerStatusForSubmission(
  submission: RawSubmission,
  createdNewDuringAccept = false,
): PortalCustomerStatus {
  if (createdNewDuringAccept || submission.metadata?.customerRegisteredAt != null) {
    return "new";
  }
  return resolvePortalCustomerStatus(submission.customerId);
}

async function lookupTransactionIdByReference(
  businessId: string,
  referenceId: string,
): Promise<string | undefined> {
  const refId = referenceId.trim();
  if (!refId) return undefined;
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("referenceId", "==", refId)
    .limit(1)
    .get();
  return snap.docs[0]?.id;
}

async function notifyPortalOrderFulfilledIfNeeded(
  businessId: string,
  submission: RawSubmission,
  userId: string,
  customerName: string | undefined,
  createdNewDuringAccept: boolean,
): Promise<void> {
  if (
    submission.submissionType !== "PLACE_ORDER" &&
    submission.submissionType !== "REQUEST_COLLECTION"
  ) {
    return;
  }

  const referenceId = String(submission.referenceId || "").trim();
  const transactionId = await lookupTransactionIdByReference(
    businessId,
    referenceId,
  );

  await notifyPortalSubmissionFulfilled(
    businessId,
    {
      submissionId: submission.id || "",
      submissionType: submission.submissionType,
      customerId: String(submission.customerId || "").trim(),
      customerName: customerName || "Customer",
      referenceId,
      transactionId,
      portalOrderKind: submission.metadata?.portalOrderKind,
      portalCustomerStatus: resolvePortalCustomerStatusForSubmission(
        submission,
        createdNewDuringAccept,
      ),
    },
    userId,
  ).catch((err) => {
    logger.warn("notifyPortalSubmissionFulfilled failed", {
      businessId,
      submissionId: submission.id,
      err,
    });
  });
}

/**
 * Resolve unit price: customer override → business waterType price → default
 * @param {string} businessId The ID of the business
 * @param {string} waterTypeId The ID of the water type
 * @param {any} customer The customer document data
 */
async function resolveWaterPrice(
  businessId: string,
  waterTypeId: string,
  customer: Awaited<ReturnType<typeof CustomerService.getCustomer>>,
): Promise<number> {
  if (customer?.pricing && customer.pricing[waterTypeId] !== undefined) {
    return customer.pricing[waterTypeId];
  }

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const waterTypes: any[] = bizSnap.data()?.waterTypes || [];
  for (const wt of waterTypes) {
    const wtId = typeof wt === "string" ? wt : wt.id || wt.water || wt.name;
    if (wtId === waterTypeId && typeof wt === "object" && wt.price != null) {
      return Number(wt.price);
    }
  }

  return DEFAULT_WATER_PRICE;
}

/** Ledger-only label for anonymous counter walk-in — not a saved customer profile. */
function walkInTransactionCustomerName(submission: RawSubmission): string {
  const profile = (submission.payload.profile || {}) as Record<string, unknown>;
  const fromProfile =
    typeof profile.name === "string" ? profile.name.trim() : "";
  return fromProfile || "Walk-in";
}

/**
 * If the customer has no pricing entry for a water type, check the business price.
 * If the business price exists and differs from what's stored, update the customer.
 * @param {string} businessId The ID of the business
 * @param {string} customerId The ID of the customer
 * @param {any} customer The customer document data
 * @param {string[]} waterTypeIds The list of water type IDs to check
 */
async function syncCustomerWaterPricing(
  businessId: string,
  customerId: string,
  customer: Awaited<ReturnType<typeof CustomerService.getCustomer>>,
  waterTypeIds: string[],
): Promise<void> {
  if (!customer || !customerId) return;

  const bizSnap = await db.collection("businesses").doc(businessId).get();
  const waterTypes: any[] = bizSnap.data()?.waterTypes || [];

  const pricingUpdates: Record<string, number> = {};

  for (const waterTypeId of waterTypeIds) {
    const existingPrice = customer.pricing?.[waterTypeId];

    let bizPrice: number | undefined;
    for (const wt of waterTypes) {
      const wtId = typeof wt === "string" ? wt : wt.id || wt.water || wt.name;
      if (wtId === waterTypeId && typeof wt === "object" && wt.price != null) {
        bizPrice = Number(wt.price);
        break;
      }
    }

    if (bizPrice == null) continue;

    if (existingPrice === undefined) {
      pricingUpdates[`pricing.${waterTypeId}`] = bizPrice;
    } else if (existingPrice !== bizPrice) {
      pricingUpdates[`pricing.${waterTypeId}`] = bizPrice;
    }
  }

  if (Object.keys(pricingUpdates).length > 0) {
    await db
      .collection("businesses")
      .doc(businessId)
      .collection("customers")
      .doc(customerId)
      .update({ ...pricingUpdates, updatedAt: FieldValue.serverTimestamp() });
    logger.info("synced customer water pricing", {
      businessId,
      customerId,
      pricingUpdates,
    });
  }
}

type SubmissionHandler = (
  businessId: string,
  submission: RawSubmission,
  userId: string,
  customer: Awaited<ReturnType<typeof CustomerService.getCustomer>> | null,
) => Promise<void>;

const submissionHandlers: Record<string, SubmissionHandler> = {
  PROFILE_UPDATE: async (businessId, submission) => {
    const profile = (submission.payload.profile || {}) as Record<
      string,
      unknown
    >;
    const addr = submission.payload.address;
    const updates: Record<string, unknown> = {};
    const allow = ["name", "email", "phone", "type", "companyName"] as const;
    for (const k of allow) {
      if (profile[k] !== undefined) updates[k] = profile[k];
    }
    if (addr?.line != null) updates.address = addr.line;
    if (addr?.latitude != null) updates.latitude = addr.latitude;
    if (addr?.longitude != null) updates.longitude = addr.longitude;
    await CustomerService.updateCustomer(
      businessId,
      submission.customerId,
      updates as any,
    );
  },

  PLACE_ORDER: async (businessId, submission, userId, customer) => {
    const isWalkinPayload = submission.payload.type === "walkin";
    if (!customer && !isWalkinPayload) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }
    const lines = submission.payload.refillItems || [];

    const refills = await Promise.all(
      lines.map(async (r) => {
        const adjustedUnit =
          typeof r.unitPrice === "number" &&
          Number.isFinite(r.unitPrice) &&
          r.unitPrice >= 0 ?
            r.unitPrice :
            await resolveWaterPrice(businessId, r.type, customer);
        const deliveredQty = Math.max(0, Math.floor(Number(r.qty) || 0));
        const rawPaid = (r as { paidQuantity?: number }).paidQuantity;
        const paidQty =
          typeof rawPaid === "number" &&
          Number.isFinite(rawPaid) &&
          rawPaid >= 0 ?
            Math.floor(rawPaid) :
            deliveredQty;
        return {
          waterTypeId: r.type,
          name: r.type,
          quantity: deliveredQty,
          ...(paidQty !== deliveredQty ? { paidQuantity: paidQty } : {}),
          unitPrice: adjustedUnit,
          subtotal: adjustedUnit * paidQty,
        };
      }),
    );

    const otherItemsRaw = submission.payload.inventoryItems || [];
    const otherItems = await Promise.all(
      otherItemsRaw.map(async (i) => {
        const item = await InventoryService.getItem(businessId, i.inventoryId);
        const rawUnit = (i as { unitPrice?: number }).unitPrice;
        let unitPrice = 0;
        if (
          typeof rawUnit === "number" &&
          Number.isFinite(rawUnit) &&
          rawUnit >= 0
        ) {
          unitPrice = rawUnit;
        } else if (isWalkinPayload && item && typeof item.cost === "number") {
          unitPrice = item.cost;
        }
        const qty = i.qty ?? 0;
        return {
          inventoryId: i.inventoryId,
          name: item?.name || i.inventoryId,
          quantity: qty,
          unitPrice,
          subtotal: unitPrice * qty,
        };
      }),
    );

    /** Container dispatch only — water refills live on `waterRefills`, not `items`. */
    const invItems = otherItems;

    const returns = submission.payload.returnContainers || [];
    const collectionItems = await Promise.all(
      returns.map(async (r) => {
        const item = await InventoryService.getItem(businessId, r.inventoryId);
        return {
          inventoryId: r.inventoryId,
          name: item?.name || r.inventoryId,
          qtyExpected: r.qty,
          qtyCollected: 0,
          qtyOk: 0,
          qtyDamaged: 0,
          qtyMissing: r.qty,
          deficitQty: r.qty,
          status: "missing" as const,
        };
      }),
    );

    const pay = submission.payload.payment;
    const amountPaid = pay?.amountPaid ?? 0;
    const refillSubtotal = refills.reduce((acc, r) => acc + r.subtotal, 0);
    const itemSubtotal = invItems.reduce(
      (acc, item) => acc + (item.subtotal ?? 0),
      0,
    );
    const calculatedTotal = refillSubtotal + itemSubtotal;
    const payloadTotal = submission.payload.totalAmount;
    const declaredTotal =
      typeof payloadTotal === "number" &&
      Number.isFinite(payloadTotal) &&
      payloadTotal > 0 ?
        payloadTotal :
        calculatedTotal;
    const { amountPaid: paid, balanceDue, paymentStatus } = derivePaymentFields(
      declaredTotal,
      amountPaid,
    );

    const isWalkin = submission.payload.type === "walkin";

    await TransactionService.addTransaction(
      businessId,
      {
        referenceId: submission.referenceId,
        type: isWalkin ? "walkin" : "delivery",
        customerId: submission.customerId || undefined,
        customerName: customer?.name ?? walkInTransactionCustomerName(submission),
        waterRefills: refills,
        items: invItems,
        collectionItems: isWalkin ? [] : collectionItems,
        totalAmount: declaredTotal,
        amountPaid: paid,
        balanceDue,
        paymentMethod: (pay?.method as any) || "cash",
        paymentStatus,
        deliveryStatus:
          submission.payload.deliveryStatus ||
          (isWalkin ? "pending" : "placed"),
        riderId: isWalkin ? undefined : submission.payload.riderId,
        riderName: isWalkin ? undefined : submission.payload.riderName,
        attachmentUrl: pay?.proofUrl,
        signatureUrl: submission.payload.signatureDataUrl,
        notes:
          submission.payload.notes ||
          (isWalkin ? "Counter walk-in order" : "Portal order"),
        scheduledAt: isWalkin ? new Date() : submission.payload.scheduledAt,
        ...(typeof submission.metadata?.walkInQueueNumber === "number" ?
          { walkInQueueNumber: submission.metadata.walkInQueueNumber } :
          {}),
      },
      userId,
    );

    if (submission.customerId) {
      const waterTypeIds = lines.map((r) => r.type);
      await syncCustomerWaterPricing(
        businessId,
        submission.customerId,
        customer,
        waterTypeIds,
      );
    }
  },

  REQUEST_COLLECTION: async (businessId, submission, userId, customer) => {
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
    const returns = submission.payload.returnContainers || [];
    const collectionItems = await Promise.all(
      returns.map(async (r) => {
        const item = await InventoryService.getItem(businessId, r.inventoryId);
        return {
          inventoryId: r.inventoryId,
          name: item?.name || r.inventoryId,
          qtyExpected: r.qty,
          qtyCollected: 0,
          qtyOk: 0,
          qtyDamaged: 0,
          qtyMissing: 0,
          deficitQty: 0,
          status: "pending" as const,
        };
      }),
    );
    await TransactionService.addTransaction(
      businessId,
      {
        referenceId: submission.referenceId,
        type: "collection",
        customerId: submission.customerId,
        customerName: customer.name,
        collectionItems,
        totalAmount: 0,
        amountPaid: 0,
        balanceDue: 0,
        paymentStatus: "N/A",
        paymentMethod: "other",
        deliveryStatus: "pending",
        signatureUrl: submission.payload.signatureDataUrl,
        notes: "Portal collection request",
      },
      userId,
    );
  },

  MARK_TX_COMPLETE: async (businessId, submission, userId) => {
    const { txDocId, current } = await resolvePortalCompletionTransaction(
      businessId,
      submission.customerId || "",
      submission.payload,
    );
    const updates =
      current.deliveryStatus === "completed" ?
        buildPortalBalancePaymentUpdates(current, submission.payload) :
        buildPortalCompletionTransactionUpdates(current, submission.payload);
    await applyPortalCompletionTransactionPatch(
      businessId,
      txDocId,
      updates,
      userId,
    );
    await maybeDeleteRawSubmissionsAfterPaidComplete(
      businessId,
      txDocId,
      String(
        submission.payload.transactionReferenceId || current.referenceId || "",
      ),
      submission.id,
    );
  },

  PORTAL_PAY_BALANCE: async (businessId, submission, userId) => {
    const { txDocId, current: resolved } =
      await resolvePortalBalancePaymentTransaction(
        businessId,
        submission.customerId || "",
        submission.payload,
        { allowAlreadyPaid: true },
      );
    const latest =
      (await TransactionService.getTransaction(businessId, txDocId)) ||
      resolved;
    if (!latest) {
      throw new Error("TX_NOT_FOUND");
    }
    const alreadyPaid =
      String(latest.paymentStatus || "").toLowerCase() === "paid";

    // Prior accept may have written payment then failed on post-commit/email.
    // Skip re-patching when already paid so staff confirm can finish cleanly.
    if (!alreadyPaid) {
      assertPortalAdvancePaymentFullAmount(latest, submission.payload);
      const updates = buildPortalBalancePaymentUpdates(
        latest,
        submission.payload,
      );
      await applyPortalCompletionTransactionPatch(
        businessId,
        txDocId,
        updates,
        userId,
      );
      const after = await TransactionService.getTransaction(businessId, txDocId);
      if (after) {
        try {
          await maybeSendAdvancePaymentReceiptEmail(
            businessId,
            submission,
            latest,
            after,
          );
        } catch (emailErr) {
          logger.error("portal_advance_payment_receipt_email_failed", emailErr);
        }
      }
    }

    await maybeDeleteRawSubmissionsAfterPaidComplete(
      businessId,
      txDocId,
      String(
        submission.payload.transactionReferenceId || latest.referenceId || "",
      ),
      submission.id,
    );
  },
};

/**
 * Applies an owner-approved raw submission to canonical records.
 */
export class RawSubmissionProcessor {
  static async accept(
    businessId: string,
    submission: RawSubmission,
    userId: string,
  ): Promise<void> {
    const subId = submission.id;
    if (!subId) throw new Error("MISSING_SUBMISSION_ID");

    if (
      submission.submissionType === "MARK_TX_COMPLETE" ||
      submission.submissionType === "PORTAL_PAY_BALANCE"
    ) {
      const customerId = String(submission.customerId || "").trim();
      if (customerId) {
        await mergePortalProfileFromSubmission(
          businessId,
          customerId,
          submission.payload,
        );
      }

      const handler = submissionHandlers[submission.submissionType];
      if (!handler) throw new Error("UNKNOWN_SUBMISSION_TYPE");

      // Completion receipt is for post-delivery settlement only — never advance pay.
      let sendCompletionReceipt = false;
      if (submission.submissionType === "MARK_TX_COMPLETE") {
        const { current } = await resolvePortalCompletionTransaction(
          businessId,
          submission.customerId || "",
          submission.payload,
        );
        sendCompletionReceipt = current.deliveryStatus === "completed";
      } else if (
        submission.submissionType === "PORTAL_PAY_BALANCE" &&
        submission.payload.portalPaymentPhase === "balance"
      ) {
        sendCompletionReceipt = true;
      }

      await handler(businessId, submission, userId, null as any);
      await RawSubmissionService.updateStatus(businessId, subId, {
        status: "processed",
        processedAt: FieldValue.serverTimestamp() as any,
        processedByUid: userId,
      });
      logger.info("raw_submission processed", {
        businessId,
        subId,
        type: submission.submissionType,
      });

      if (sendCompletionReceipt) {
        try {
          await maybeNotifyPortalCompletionReceipt({ businessId, submission });
        } catch (emailErr) {
          logger.error("portal_completion_receipt_notify_failed", emailErr);
        }
      }
      return;
    }

    const payloadRecord = submission.payload as Record<string, unknown>;
    const resolvedCustomerId = String(
      payloadRecord.resolvedCustomerId || "",
    ).trim();
    let linkedCustomerId = String(submission.customerId || "").trim();
    if (!linkedCustomerId && resolvedCustomerId) {
      linkedCustomerId = resolvedCustomerId;
      await RawSubmissionService.updateStatus(businessId, subId, {
        customerId: resolvedCustomerId,
      });
      submission.customerId = resolvedCustomerId;
    }

    let customer = linkedCustomerId ?
      await CustomerService.getCustomer(businessId, linkedCustomerId) :
      null;
    let createdNewPortalCustomer = false;

    if (!customer) {
      if (submission.submissionType === "COMPLETE_TX") {
        throw new Error("CUSTOMER_NOT_FOUND");
      }
      const isWalkin = submission.payload.type === "walkin";
      if (isWalkin) {
        customer = null;
      } else {
        await CustomerActiveLimitService.assertCanAddActiveCustomer(businessId);
        const profile = submission.payload.profile || {};
        const addr = submission.payload.address || {};
        const sukiType =
          profile.sukiType === "commercial" ? "commercial" : "residential";
        const businessSnap = await db
          .collection("businesses")
          .doc(businessId)
          .get();
        const containerPolicy = getBusinessContainerDefaultPolicy(
          businessSnap.data() as Record<string, unknown> | undefined,
        );
        customer = await CustomerService.addCustomer(businessId, {
          name: (profile.name as string) || "New Suki",
          phone: (profile.phone as string) || "",
          email: (profile.email as string) || "",
          address: (addr.line as string) || "",
          latitude: addr.latitude != null ? Number(addr.latitude) : 0,
          longitude: addr.longitude != null ? Number(addr.longitude) : 0,
          type: sukiType,
          companyName:
            sukiType === "commercial" && typeof profile.companyName === "string" ?
              profile.companyName.trim() || undefined :
              undefined,
          containerPolicy,
        });
        if (customer.id) {
          await RawSubmissionService.updateStatus(businessId, subId, {
            customerId: customer.id,
          });
          submission.customerId = customer.id;
          createdNewPortalCustomer = true;
        }
      }
    } else {
      const profile = submission.payload.profile || {};
      const addr = submission.payload.address || {};
      const updates: Record<string, unknown> = {};

      if (profile.name) updates.name = profile.name;
      if (profile.phone) updates.phone = profile.phone;
      if (profile.email) updates.email = profile.email;
      if (profile.portalEmailNotifications === true) {
        updates.portalEmailNotifications = true;
      }
      if (profile.sukiType === "commercial") {
        updates.type = "commercial";
        if (profile.companyName) updates.companyName = profile.companyName;
      } else if (profile.sukiType === "personal") {
        updates.type = "residential";
      }
      if (addr.line) updates.address = addr.line;
      if (addr.latitude !== undefined) updates.latitude = addr.latitude;
      if (addr.longitude !== undefined) updates.longitude = addr.longitude;

      if (Object.keys(updates).length > 0 && customer.id) {
        await CustomerService.updateCustomer(
          businessId,
          customer.id,
          updates as any,
        );
        customer = (await CustomerService.getCustomer(
          businessId,
          customer.id,
        )) ?? customer;
      }

      customer = await ensureCustomerActiveForPortalAcceptance(
        businessId,
        customer,
      );
    }

    const handler = submissionHandlers[submission.submissionType];
    if (!handler) {
      throw new Error("UNKNOWN_SUBMISSION_TYPE");
    }

    await handler(businessId, submission, userId, customer);

    if (createdNewPortalCustomer) {
      await RawSubmissionService.markCustomerRegisteredFromPortal(
        businessId,
        subId,
      );
    }

    await RawSubmissionService.updateStatus(businessId, subId, {
      status: "processed",
      processedAt: FieldValue.serverTimestamp() as any,
      processedByUid: userId,
    });

    await notifyPortalOrderFulfilledIfNeeded(
      businessId,
      submission,
      userId,
      customer?.name,
      createdNewPortalCustomer,
    );

    logger.info("raw_submission processed", {
      businessId,
      subId,
      type: submission.submissionType,
    });
  }

  /**
   * Station declines a pending portal submission (customer-facing: "cancelled").
   * @param {string} businessId The ID of the business
   * @param {string} submissionId The ID of the submission
   * @param {string} userId The ID of the user performing the cancellation
   * @param {string} [reason] The reason for cancellation
   */
  static async cancelPending(
    businessId: string,
    submissionId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    await RawSubmissionService.updateStatus(businessId, submissionId, {
      status: "cancelled",
      processedAt: FieldValue.serverTimestamp() as any,
      processedByUid: userId,
      rejectReason: reason?.slice(0, 500),
    });
    logger.info("raw_submission cancelled", {
      businessId,
      submissionId,
      userId,
    });
  }
}
