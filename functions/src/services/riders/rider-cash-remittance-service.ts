import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "./rider-service";

export interface RiderCashRemittance {
  id: string;
  businessId: string;
  riderId: string;
  riderName: string;
  remittanceDate: string;
  amountAccepted: number;
  recordedFromOrders?: number;
  acceptedByUserId: string;
  acceptedAt: string;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function remittanceDocId(riderId: string, remittanceDate: string): string {
  return `${riderId}_${remittanceDate}`;
}

function serializeRemittance(
  docId: string,
  data: FirebaseFirestore.DocumentData,
): RiderCashRemittance {
  const acceptedAtRaw = data.acceptedAt;
  const acceptedAt =
    acceptedAtRaw?.toDate?.()?.toISOString?.() ??
    (typeof acceptedAtRaw === "string" ? acceptedAtRaw : new Date().toISOString());

  return {
    id: docId,
    businessId: String(data.businessId ?? ""),
    riderId: String(data.riderId ?? ""),
    riderName: String(data.riderName ?? ""),
    remittanceDate: String(data.remittanceDate ?? ""),
    amountAccepted: Number(data.amountAccepted ?? 0),
    recordedFromOrders:
      data.recordedFromOrders != null ? Number(data.recordedFromOrders) : undefined,
    acceptedByUserId: String(data.acceptedByUserId ?? ""),
    acceptedAt,
  };
}

export class RiderCashRemittanceService {
  static validateDateKey(remittanceDate: string): boolean {
    return DATE_KEY_RE.test(remittanceDate);
  }

  static async listBetween(
    businessId: string,
    fromDate: string,
    toDate: string,
  ): Promise<RiderCashRemittance[]> {
    if (
      !RiderCashRemittanceService.validateDateKey(fromDate) ||
      !RiderCashRemittanceService.validateDateKey(toDate)
    ) {
      throw new Error("INVALID_DATE");
    }
    if (fromDate > toDate) {
      throw new Error("INVALID_RANGE");
    }

    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("rider_cash_remittances")
        .where("remittanceDate", ">=", fromDate)
        .where("remittanceDate", "<=", toDate)
        .get();

      return snapshot.docs
        .map((doc) => serializeRemittance(doc.id, doc.data()))
        .sort((a, b) => a.remittanceDate.localeCompare(b.remittanceDate));
    } catch (error) {
      logger.error("Error listing rider cash remittances in range", {
        businessId,
        fromDate,
        toDate,
        error,
      });
      throw error;
    }
  }

  static async listByDate(
    businessId: string,
    remittanceDate: string,
  ): Promise<RiderCashRemittance[]> {
    if (!RiderCashRemittanceService.validateDateKey(remittanceDate)) {
      throw new Error("INVALID_DATE");
    }

    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("rider_cash_remittances")
        .where("remittanceDate", "==", remittanceDate)
        .get();

      return snapshot.docs.map((doc) => serializeRemittance(doc.id, doc.data()));
    } catch (error) {
      logger.error("Error listing rider cash remittances", { businessId, remittanceDate, error });
      throw error;
    }
  }

  static async acceptRemittance(
    businessId: string,
    riderId: string,
    input: {
      remittanceDate: string;
      amountAccepted: number;
      recordedFromOrders?: number;
      acceptedByUserId: string;
    },
  ): Promise<RiderCashRemittance> {
    const { remittanceDate, amountAccepted, recordedFromOrders, acceptedByUserId } = input;

    if (!RiderCashRemittanceService.validateDateKey(remittanceDate)) {
      throw new Error("INVALID_DATE");
    }
    if (!Number.isFinite(amountAccepted) || amountAccepted < 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const rider = await RiderService.getRider(businessId, riderId);
    if (!rider?.id) {
      throw new Error("RIDER_NOT_FOUND");
    }

    const docId = remittanceDocId(riderId, remittanceDate);
    const docRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("rider_cash_remittances")
      .doc(docId);

    const payload = {
      businessId,
      riderId,
      riderName: rider.name,
      remittanceDate,
      amountAccepted: Math.round(amountAccepted * 100) / 100,
      recordedFromOrders:
        recordedFromOrders != null && Number.isFinite(recordedFromOrders) ?
          Math.round(recordedFromOrders * 100) / 100 :
          null,
      acceptedByUserId,
      acceptedAt: FieldValue.serverTimestamp(),
    };

    await docRef.set(payload, { merge: true });

    const saved = await docRef.get();
    return serializeRemittance(saved.id, saved.data() ?? payload);
  }
}
