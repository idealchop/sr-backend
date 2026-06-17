import { db, FieldValue } from "../../config/firebase-admin";
import { CustomerService } from "../customers/customer-service";
import type { Transaction } from "../transactions/transaction-service";
import { normalizePortalStarRating } from "./portal-rating-updates";
import type { RawSubmissionPayload } from "./raw-submission-types";

export type PortalOrderRatingSource =
  | "portal_track_complete"
  | "portal_balance_pay"
  | "portal_ratings"
  | "portal_counter_walkin";

export interface PortalOrderRatingRecord {
  businessId: string;
  transactionId: string;
  transactionReferenceId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  riderId?: string;
  riderName?: string;
  serviceRating?: number;
  wrsRating?: number;
  riderRating?: number;
  feedback?: string;
  source: PortalOrderRatingSource;
  createdAt: unknown;
}

/**
 * True when the portal payload includes at least one star rating or feedback text.
 * @param {RawSubmissionPayload} payload Portal submission payload.
 * @return {boolean}
 */
export function portalPayloadHasRatingInput(
  payload: RawSubmissionPayload,
): boolean {
  const service = normalizePortalStarRating(
    payload.serviceRating ?? payload.rating,
  );
  const wrs = normalizePortalStarRating(payload.wrsRating);
  const rider = normalizePortalStarRating(payload.riderRating);
  const feedback =
    typeof payload.feedback === "string" ? payload.feedback.trim() : "";
  return Boolean(service || wrs || rider || feedback);
}

/**
 * Persists optional portal ratings for analytics under
 * `businesses/{businessId}/portal_order_ratings`.
 */
export class PortalOrderRatingService {
  static ratingsCol(businessId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("portal_order_ratings");
  }

  static async recordFromPortalPayload(args: {
    businessId: string;
    txDocId: string;
    transaction: Pick<
      Transaction,
      "referenceId" | "customerId" | "customerName" | "riderId" | "riderName"
    >;
    payload: RawSubmissionPayload;
    customerIdHint?: string;
    source: PortalOrderRatingSource;
  }): Promise<string | null> {
    if (!portalPayloadHasRatingInput(args.payload)) {
      return null;
    }

    const service = normalizePortalStarRating(
      args.payload.serviceRating ?? args.payload.rating,
    );
    const wrs = normalizePortalStarRating(args.payload.wrsRating);
    const rider = normalizePortalStarRating(args.payload.riderRating);
    const feedback =
      typeof args.payload.feedback === "string" ?
        args.payload.feedback.trim().slice(0, 500) :
        undefined;

    const customerId =
      String(args.customerIdHint || args.transaction.customerId || "").trim() ||
      undefined;

    let customerName = args.transaction.customerName;
    let customerPhone: string | undefined;
    let customerEmail: string | undefined;

    if (customerId) {
      const customer = await CustomerService.getCustomer(
        args.businessId,
        customerId,
      );
      if (customer) {
        customerName = customer.name || customerName;
        customerPhone = customer.phone || undefined;
        customerEmail = customer.email || undefined;
      }
    }

    const ref = PortalOrderRatingService.ratingsCol(args.businessId).doc();
    const record: PortalOrderRatingRecord = {
      businessId: args.businessId,
      transactionId: args.txDocId,
      transactionReferenceId: String(
        args.payload.transactionReferenceId ||
          args.transaction.referenceId ||
          "",
      ).trim(),
      source: args.source,
      createdAt: FieldValue.serverTimestamp(),
      ...(customerId ? { customerId } : {}),
      ...(customerName ? { customerName } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(customerEmail ? { customerEmail } : {}),
      ...(args.transaction.riderId ?
        { riderId: String(args.transaction.riderId) } :
        {}),
      ...(args.transaction.riderName ?
        { riderName: args.transaction.riderName } :
        {}),
      ...(service !== undefined ? { serviceRating: service } : {}),
      ...(wrs !== undefined ? { wrsRating: wrs } : {}),
      ...(rider !== undefined ? { riderRating: rider } : {}),
      ...(feedback ? { feedback } : {}),
    };

    await ref.set(record);
    return ref.id;
  }
}
