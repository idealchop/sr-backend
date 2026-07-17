import { Request, Response } from "express";
import { db } from "../../config/firebase-admin";
import { logger } from "../../services/observability/logging/logger";
import { QrCustomerService } from "../../services/customers/qr-customer-service";
import { resolvePortalCompletionTransaction } from
  "../../services/portal/portal-transaction-completion";
import { resolvePortalBalancePaymentTransaction } from
  "../../services/portal/portal-balance-payment";
import { ratingPatchFromPortalPayload } from "../../services/portal/portal-rating-updates";
import { PortalOrderRatingService } from "../../services/portal/portal-order-rating-service";
import { RawSubmissionService } from "../../services/portal/raw-submission-service";
import { TransactionService } from "../../services/transactions/transaction-service";
import { CustomerService } from "../../services/customers/customer-service";
import type {
  RawSubmissionPayload,
  RawSubmissionType,
} from "../../services/portal/raw-submission-types";
import {
  customerNeedsContainerCustodyAcceptance,
  stampCustomerContainerCustodyAcceptance,
} from "../../services/customers/container-custody-agreement";
import { applyPortalContainerSetup } from "../../services/portal/portal-container-setup-service";
import { submissionHasDeliveryOwnedAssetAddons } from "../../services/portal/delivery-owned-asset-addon";
import { reconcileByogRefillPolicyIfNeeded } from "../../services/customers/byog-refill-policy";
import { resolvePortalTrackCustomerId } from "../../services/portal/resolve-portal-track-customer";

const SUBMISSION_TYPES: RawSubmissionType[] = [
  "PROFILE_UPDATE",
  "PLACE_ORDER",
  "REQUEST_COLLECTION",
  "COMPLETE_TX",
  "MARK_TX_COMPLETE",
  "PORTAL_PAY_BALANCE",
  "PORTAL_PREFERRED_SCHEDULE",
  "PORTAL_CONTAINER_SETUP",
  "PORTAL_TX_RATINGS",
];

/**
 * JSON body may send ids as strings or occasionally other primitives.
 * @param {unknown} v
 * @return {string}
 */
function parseBodyString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

export const postPortalSubmission = async (req: Request, res: Response) => {
  const businessId = parseBodyString(req.body?.businessId);
  const customerId = parseBodyString(req.body?.customerId);
  const token = parseBodyString(req.body?.token);
  const submissionType = req.body?.submissionType as RawSubmissionType;
  const legalAgreed = req.body?.legalAgreed === true;
  const containerCustodyAgreed = req.body?.containerCustodyAgreed === true;
  const payload = (req.body?.payload || {}) as RawSubmissionPayload;

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }
  if (!SUBMISSION_TYPES.includes(submissionType)) {
    return res.status(400).json({ error: "Invalid submissionType" });
  }
  if (!legalAgreed) {
    return res.status(400).json({ error: "Terms must be accepted" });
  }

  try {
    const isMarkCompleteRequest =
      submissionType === "MARK_TX_COMPLETE" || submissionType === "COMPLETE_TX";

    if (isMarkCompleteRequest) {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      try {
        const { current, txDocId } = await resolvePortalCompletionTransaction(
          businessId,
          cid && tok ? cid : "",
          payload,
        );
        const custForDoc =
          String(current.customerId || "").trim() || (cid && tok ? cid : "");

        const fulfillmentKind =
          current.type === "collection" || current.type === "delivery" ?
            current.type :
            undefined;
        const enrichedPayload = {
          ...payload,
          targetTransactionId: txDocId,
          transactionReferenceId:
            (typeof payload.transactionReferenceId === "string" &&
              payload.transactionReferenceId.trim()) ||
            String(current.referenceId || "").trim(),
          ...(fulfillmentKind ? { type: fulfillmentKind } : {}),
        };

        const { id, referenceId } = await RawSubmissionService.createPending(
          businessId,
          custForDoc,
          "MARK_TX_COMPLETE",
          enrichedPayload,
          { legalAgreed, userAgent: req.get("user-agent") },
        );
        return res
          .status(201)
          .json({ data: { id, referenceId, status: "pending_review" } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_NOT_READY_FOR_COMPLETION") {
          return res.status(409).json({
            error:
              "This order cannot be completed until it is marked Delivered or Collected.",
          });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal MARK_TX_COMPLETE create failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_PAY_BALANCE") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      const amt = Number(payload.payment?.amountPaid);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res
          .status(400)
          .json({ error: "A positive payment amount is required." });
      }
      try {
        const { current, txDocId } =
          await resolvePortalBalancePaymentTransaction(
            businessId,
            cid && tok ? cid : "",
            payload,
          );
        const deliveryStatus = String(current.deliveryStatus || "").toLowerCase();
        const isAdvancePayment =
          payload.portalPaymentPhase === "advance" ||
          !["delivered", "collected", "completed"].includes(deliveryStatus);
        const payMethod = String(payload.payment?.method || "").toLowerCase();
        const cashConfirmed = payload.payment?.confirmedByRider === true;
        if (isAdvancePayment) {
          if (cashConfirmed || payMethod === "cash" || !payMethod) {
            return res.status(400).json({
              error:
                "Advance payments must use bank transfer or e-wallet. " +
                "Cash is available after delivery.",
            });
          }
          const proof = payload.payment?.proofUrl;
          const ref = String(payload.payment?.reference || "").trim();
          if (!proof && !ref) {
            return res.status(400).json({
              error:
                "Upload payment proof or enter a reference for advance payment.",
            });
          }
        }
        const custForDoc =
          String(current.customerId || "").trim() || (cid && tok ? cid : "");

        const paymentPhase: "advance" | "balance" = isAdvancePayment ?
          "advance" :
          "balance";
        const enrichedPayload = {
          ...payload,
          portalPaymentPhase: paymentPhase,
          targetTransactionId: txDocId,
          transactionReferenceId:
            (typeof payload.transactionReferenceId === "string" &&
              payload.transactionReferenceId.trim()) ||
            String(current.referenceId || "").trim(),
        };

        await PortalOrderRatingService.recordFromPortalPayload({
          businessId,
          txDocId,
          transaction: current,
          payload: enrichedPayload,
          customerIdHint: custForDoc,
          source: "portal_balance_pay",
        });

        const { id, referenceId } = await RawSubmissionService.createPending(
          businessId,
          custForDoc,
          "PORTAL_PAY_BALANCE",
          enrichedPayload,
          { legalAgreed, userAgent: req.get("user-agent") },
        );
        return res
          .status(201)
          .json({ data: { id, referenceId, status: "pending_review" } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_ALREADY_PAID") {
          return res
            .status(409)
            .json({ error: "This order is already fully paid." });
        }
        if (msg === "TX_NOT_ELIGIBLE_FOR_PORTAL_PAYMENT") {
          return res
            .status(400)
            .json({ error: "Balance payments apply to delivery orders only." });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal PORTAL_PAY_BALANCE create failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_PREFERRED_SCHEDULE") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      const schedule = payload.schedule;
      if (!schedule || typeof schedule !== "object") {
        return res.status(400).json({ error: "Schedule details are required." });
      }
      const isDeliveryEnabled = schedule.isDeliveryEnabled === true;
      const isCollectionEnabled = schedule.isCollectionEnabled === true;
      if (!isDeliveryEnabled && !isCollectionEnabled) {
        return res.status(400).json({
          error: "Enable delivery or collection schedule before saving.",
        });
      }
      try {
        const resolvedCustomerId = await resolvePortalTrackCustomerId(businessId, {
          customerId: cid,
          token: tok,
          targetTransactionId:
            typeof payload.targetTransactionId === "string" ?
              payload.targetTransactionId :
              "",
          transactionReferenceId:
            typeof payload.transactionReferenceId === "string" ?
              payload.transactionReferenceId :
              "",
          customerIdHint:
            typeof payload.customerIdHint === "string" ?
              payload.customerIdHint :
              "",
        });
        if (!resolvedCustomerId) {
          return res.status(401).json({
            error: "Open the portal from your station QR link to save your preferred schedule.",
          });
        }
        await CustomerService.updateCustomer(businessId, resolvedCustomerId, {
          isDeliveryEnabled,
          isCollectionEnabled,
          deliveryConfig: isDeliveryEnabled ?
            (schedule.deliveryConfig as Record<string, unknown>) || { frequency: "weekly" } :
            undefined,
          collectionConfig: isCollectionEnabled ?
            (schedule.collectionConfig as Record<string, unknown>) || { frequency: "weekly" } :
            undefined,
        } as any);
        return res.json({ data: { success: true } });
      } catch (e) {
        logger.error("portal PORTAL_PREFERRED_SCHEDULE failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_CONTAINER_SETUP") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      const setup = payload.containerSetup;
      if (!setup || typeof setup !== "object") {
        return res.status(400).json({ error: "Container setup details are required." });
      }
      const policy = setup.containerPolicy;
      if (policy !== "byog" && policy !== "wrs_rotation") {
        return res.status(400).json({
          error: "Choose whether the station provides containers or you bring your own.",
        });
      }
      try {
        const resolvedCustomerId = await resolvePortalTrackCustomerId(businessId, {
          customerId: cid,
          token: tok,
          targetTransactionId:
            typeof payload.targetTransactionId === "string" ?
              payload.targetTransactionId :
              "",
          transactionReferenceId:
            typeof payload.transactionReferenceId === "string" ?
              payload.transactionReferenceId :
              "",
          customerIdHint:
            typeof payload.customerIdHint === "string" ?
              payload.customerIdHint :
              "",
        });
        if (!resolvedCustomerId) {
          return res.status(401).json({
            error: "Open the portal from your station QR link to save your container setup.",
          });
        }
        await applyPortalContainerSetup(businessId, resolvedCustomerId, {
          containerPolicy: policy,
          ownContainers: setup.ownContainers,
        });
        return res.json({ data: { success: true } });
      } catch (e: any) {
        if (e?.message === "BYOG_CONTAINERS_REQUIRED") {
          return res.status(400).json({
            error: "Add at least one container type you bring to the station.",
          });
        }
        if (e?.message === "INVALID_CONTAINER_ITEM") {
          return res.status(400).json({
            error: "One or more container types are not valid for this station.",
          });
        }
        logger.error("portal PORTAL_CONTAINER_SETUP failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (submissionType === "PORTAL_TX_RATINGS") {
      const cid = parseBodyString(req.body?.customerId);
      const tok = parseBodyString(req.body?.token);
      if (cid && tok) {
        await QrCustomerService.assertValidPortalToken(businessId, cid, tok);
      }
      try {
        const { current, txDocId } = await resolvePortalCompletionTransaction(
          businessId,
          cid && tok ? cid : "",
          payload,
        );
        if (
          cid &&
          tok &&
          current.customerId &&
          String(current.customerId) !== cid
        ) {
          return res.status(403).json({ error: "Forbidden" });
        }
        const patch = ratingPatchFromPortalPayload(payload);
        if (Object.keys(patch).length === 0) {
          return res.status(400).json({
            error: "Add at least one star rating or a short written note.",
          });
        }

        await PortalOrderRatingService.recordFromPortalPayload({
          businessId,
          txDocId,
          transaction: current,
          payload,
          customerIdHint: cid && tok ? cid : undefined,
          source:
            payload.portalRatingSource === "portal_track_complete" ||
            payload.portalRatingSource === "portal_balance_pay" ||
            payload.portalRatingSource === "portal_ratings" ||
            payload.portalRatingSource === "portal_counter_walkin" ?
              payload.portalRatingSource :
              "portal_ratings",
        });

        await TransactionService.updateTransaction(
          businessId,
          txDocId,
          patch as Record<string, unknown>,
          "portal_customer",
        );
        return res.json({ data: { success: true } });
      } catch (e: any) {
        const msg = e?.message as string | undefined;
        if (msg === "TX_NOT_FOUND") {
          return res.status(404).json({ error: "Order not found" });
        }
        if (msg === "TX_FORBIDDEN") {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (msg === "TX_NOT_READY_FOR_COMPLETION") {
          return res.status(409).json({
            error:
              "Ratings are available after the order is delivered or collected.",
          });
        }
        if (msg === "MISSING_TX_REFERENCE") {
          return res
            .status(400)
            .json({ error: "Transaction id or reference is required." });
        }
        logger.error("portal PORTAL_TX_RATINGS failed", e);
        return res.status(500).json({ error: "Server error" });
      }
    }

    if (customerId && token) {
      await QrCustomerService.assertValidPortalToken(
        businessId,
        customerId,
        token,
      );

      let placeOrderHasOwnedAssetAddons = false;

      if (submissionType === "PLACE_ORDER") {
        const bizSnap = await db.collection("businesses").doc(businessId).get();
        const biz = bizSnap.data() as Record<string, unknown> | undefined;
        placeOrderHasOwnedAssetAddons = await submissionHasDeliveryOwnedAssetAddons(
          businessId,
          payload.inventoryItems,
          biz?.deliveryInventorySalesEnabled === true,
        );

        if (!placeOrderHasOwnedAssetAddons) {
          await reconcileByogRefillPolicyIfNeeded(
            businessId,
            customerId,
            payload.refillItems,
          );
        }
      }

      const bizSnap = await db.collection("businesses").doc(businessId).get();
      const biz = bizSnap.data() as Record<string, unknown> | undefined;
      const customer = await CustomerService.getCustomer(businessId, customerId);
      const skipCustodyForOwnedAssetAddons =
        submissionType === "PLACE_ORDER" && placeOrderHasOwnedAssetAddons;
      if (
        customer &&
        biz &&
        !skipCustodyForOwnedAssetAddons &&
        customerNeedsContainerCustodyAcceptance(customer, biz)
      ) {
        if (!containerCustodyAgreed) {
          return res.status(400).json({
            error: "CUSTODY_AGREEMENT_REQUIRED",
            message: "Container custody agreement must be accepted.",
          });
        }
        await stampCustomerContainerCustodyAcceptance(
          businessId,
          customerId,
          "portal",
        );
      }
    }

    if (payload.type === "walkin") {
      const bizSnap = await db.collection("businesses").doc(businessId).get();
      if (bizSnap.data()?.qrWalkInEnabled !== true) {
        return res.status(403).json({
          error: "Walk-in QR orders are not enabled for this station.",
          code: "QR_WALKIN_DISABLED",
        });
      }
    }

    // If no customerId, we still allow submission (e.g. for new customers)
    // The dashboard will handle creating/linking the customer during review.
    const { id, referenceId, walkInQueueNumber } = await RawSubmissionService.createPending(
      businessId,
      customerId,
      submissionType,
      payload,
      { legalAgreed, userAgent: req.get("user-agent") },
    );

    return res
      .status(201)
      .json({
        data: {
          id,
          referenceId,
          status: "pending_review",
          ...(walkInQueueNumber != null ? { walkInQueueNumber } : {}),
        },
      });
  } catch (e: any) {
    if (e?.message === "INVALID_TOKEN") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (e?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    if (e?.message === "INACTIVE_CUSTOMER") {
      return res.status(403).json({ error: "Inactive" });
    }
    if (e?.message === "LEGAL_REQUIRED") {
      return res.status(400).json({ error: "Legal consent required" });
    }
    if (e?.code === "ONLINE_ORDER_LIMIT_EXCEEDED") {
      return res.status(403).json({
        error:
          e?.message ||
          "This station has reached its online order limit. Please try again later.",
        code: "ONLINE_ORDER_LIMIT_EXCEEDED",
      });
    }
    logger.error("postPortalSubmission failed", e);
    return res.status(500).json({ error: "Server error" });
  }
};
