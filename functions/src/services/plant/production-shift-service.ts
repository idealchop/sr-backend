import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import { coerceToDate } from "../../utils/philippine-datetime";
import {
  buildProductionShiftDocId,
  parseProductionShiftInput,
} from "./production-shift-validation";
import type { ProductionShiftRecord } from "./production-shift-types";

function serializeShift(
  id: string,
  data: FirebaseFirestore.DocumentData,
): ProductionShiftRecord {
  const createdAt = coerceToDate(data.createdAt);
  const updatedAt = coerceToDate(data.updatedAt);
  return {
    id,
    calendarDate: String(data.calendarDate ?? ""),
    shift: data.shift === "PM" ? "PM" : "AM",
    gallonsProduced: Number(data.gallonsProduced ?? 0),
    gallonsRejected: Number(data.gallonsRejected ?? 0),
    notes: typeof data.notes === "string" ? data.notes : undefined,
    source: data.source === "iot" ? "iot" : "manual",
    recordedBy: String(data.recordedBy ?? ""),
    createdAt: createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export class ProductionShiftService {
  static collection(businessId: string) {
    return db.collection("businesses").doc(businessId).collection("production_shifts");
  }

  static async list(
    businessId: string,
    options: { limit?: number } = {},
  ): Promise<ProductionShiftRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 90);
    const snap = await this.collection(businessId)
      .orderBy("calendarDate", "desc")
      .limit(limit)
      .get();

    return snap.docs
      .map((doc) => serializeShift(doc.id, doc.data()))
      .sort((a, b) => {
        if (a.calendarDate !== b.calendarDate) {
          return a.calendarDate < b.calendarDate ? 1 : -1;
        }
        return a.shift === b.shift ? 0 : a.shift === "PM" ? -1 : 1;
      });
  }

  static async upsert(
    businessId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<ProductionShiftRecord> {
    const parsed = parseProductionShiftInput(body);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    const { calendarDate, shift, gallonsProduced, gallonsRejected, notes } = parsed.value;
    const id = buildProductionShiftDocId(calendarDate, shift);
    const ref = this.collection(businessId).doc(id);
    const existing = await ref.get();
    const now = FieldValue.serverTimestamp();

    const payload: Record<string, unknown> = {
      calendarDate,
      shift,
      gallonsProduced,
      gallonsRejected,
      source: "manual",
      recordedBy: userId,
      updatedAt: now,
      ...(notes ? { notes } : { notes: FieldValue.delete() }),
    };

    if (!existing.exists) {
      payload.createdAt = now;
    }

    await ref.set(payload, { merge: true });
    const saved = await ref.get();
    return serializeShift(saved.id, saved.data() ?? {});
  }
}
