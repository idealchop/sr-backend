import { db, FieldValue } from "../../config/firebase-admin";
import { TransactionService } from "../transactions/transaction-service";

export type PlantDowntimeReason =
  | "pump"
  | "uv"
  | "power"
  | "water_supply"
  | "other";

export type PlantDowntimeRecord = {
  id: string;
  startedAt: string;
  endedAt?: string;
  reasonCode: PlantDowntimeReason;
  notes?: string;
  estimatedGallonsLost?: number;
  expenseId?: string;
  severity: "low" | "medium" | "high";
  createdAt: string;
};

export type UpdatePlantDowntimeInput = {
  startedAt?: string;
  endedAt?: string | null;
  reasonCode: PlantDowntimeReason;
  notes?: string;
  estimatedGallonsLost?: number | null;
  severity?: "low" | "medium" | "high";
};

export type CreatePlantDowntimeInput = UpdatePlantDowntimeInput & {
  expenseId?: string;
  expense?: { amount: number; note?: string };
};
/** MP-12 — plant downtime / breakdown log. */
export class PlantDowntimeService {
  static collection(businessId: string) {
    return db.collection("businesses").doc(businessId).collection("plant_downtime");
  }

  static async list(businessId: string, limit = 50): Promise<PlantDowntimeRecord[]> {
    const snap = await this.collection(businessId)
      .orderBy("startedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => this.serialize(doc.id, doc.data()));
  }

  static serialize(id: string, data: FirebaseFirestore.DocumentData): PlantDowntimeRecord {
    const startedAt = data.startedAt?.toDate ?
      data.startedAt.toDate().toISOString() :
      String(data.startedAt || "");
    const endedAt = data.endedAt?.toDate ?
      data.endedAt.toDate().toISOString() :
      data.endedAt ? String(data.endedAt) : undefined;
    const createdAt = data.createdAt?.toDate ?
      data.createdAt.toDate().toISOString() :
      String(data.createdAt || startedAt);
    return {
      id,
      startedAt,
      endedAt,
      reasonCode: (data.reasonCode || "other") as PlantDowntimeReason,
      notes: data.notes ? String(data.notes) : undefined,
      estimatedGallonsLost:
        data.estimatedGallonsLost != null ?
          Number(data.estimatedGallonsLost) :
          undefined,
      expenseId: data.expenseId ? String(data.expenseId) : undefined,
      severity: data.severity === "high" || data.severity === "low" ?
        data.severity :
        "medium",
      createdAt,
    };
  }

  static async create(
    businessId: string,
    input: CreatePlantDowntimeInput,
    userId?: string,
  ): Promise<PlantDowntimeRecord> {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (endedAt && endedAt.getTime() <= startedAt.getTime()) {
      throw new Error("Downtime end must be after start");
    }

    await this.assertNoOverlap(businessId, startedAt, endedAt);

    let expenseId = input.expenseId;
    if (!expenseId && input.expense && Number(input.expense.amount) > 0) {
      const amount = Math.round(Number(input.expense.amount) * 100) / 100;
      const note =
        (input.expense.note || "Plant downtime repair").trim().slice(0, 200);
      const { transaction: expenseTx } = await TransactionService.addTransaction(
        businessId,
        {
          type: "expense",
          customerName: "Expenses",
          totalAmount: amount,
          amountPaid: amount,
          paymentStatus: "paid",
          paymentMethod: "cash",
          expenseCategory: "Maintenance",
          notes: note,
          scheduledAt: startedAt.toISOString(),
          deliveryStatus: "delivered",
        },
        userId,
      );
      expenseId = expenseTx.id;
    }

    const doc = {
      startedAt,
      ...(input.endedAt ? { endedAt: new Date(input.endedAt) } : {}),
      reasonCode: input.reasonCode,
      ...(input.notes ? { notes: input.notes.slice(0, 400) } : {}),
      ...(input.estimatedGallonsLost != null ?
        { estimatedGallonsLost: Math.max(0, Number(input.estimatedGallonsLost)) } :
        {}),
      ...(expenseId ? { expenseId } : {}),
      severity: input.severity ?? "medium",
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await this.collection(businessId).add(doc);
    return this.serialize(ref.id, { ...doc, createdAt: startedAt });
  }

  static async assertNoOverlap(
    businessId: string,
    startedAt: Date,
    endedAt: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const overlap = await this.collection(businessId)
      .where("startedAt", "<=", endedAt ?? startedAt)
      .limit(20)
      .get();
    for (const doc of overlap.docs) {
      if (excludeId && doc.id === excludeId) continue;
      const existing = doc.data();
      const existingStart = existing.startedAt?.toDate?.() as Date | undefined;
      const existingEnd = existing.endedAt?.toDate?.() as Date | undefined;
      if (!existingStart) continue;
      const rangeEnd = endedAt ?? new Date("2099-12-31");
      const existingRangeEnd = existingEnd ?? new Date("2099-12-31");
      if (startedAt <= existingRangeEnd && rangeEnd >= existingStart) {
        throw new Error(
          "Downtime overlaps an existing record — adjust times or end the open downtime first",
        );
      }
    }
  }

  static async updateById(
    businessId: string,
    downtimeId: string,
    input: UpdatePlantDowntimeInput,
  ): Promise<PlantDowntimeRecord> {
    const ref = this.collection(businessId).doc(downtimeId);
    const existing = await ref.get();
    if (!existing.exists) {
      throw new Error("Downtime record not found");
    }
    const existingData = existing.data() ?? {};

    const startedAt = input.startedAt ?
      new Date(input.startedAt) :
      existingData.startedAt?.toDate?.() as Date | undefined;
    if (!startedAt || Number.isNaN(startedAt.getTime())) {
      throw new Error("Invalid start time");
    }

    let endedAtForCheck: Date | null;
    if (input.endedAt === "" || input.endedAt === null) {
      endedAtForCheck = null;
    } else if (input.endedAt) {
      endedAtForCheck = new Date(input.endedAt);
    } else {
      endedAtForCheck = existingData.endedAt?.toDate?.() as Date | undefined ?? null;
    }

    if (endedAtForCheck && endedAtForCheck.getTime() <= startedAt.getTime()) {
      throw new Error("Downtime end must be after start");
    }

    await this.assertNoOverlap(businessId, startedAt, endedAtForCheck, downtimeId);

    const payload: Record<string, unknown> = {
      startedAt,
      reasonCode: input.reasonCode || existingData.reasonCode || "other",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (input.endedAt === "" || input.endedAt === null) {
      payload.endedAt = FieldValue.delete();
    } else if (input.endedAt) {
      payload.endedAt = new Date(input.endedAt);
    }

    if (input.notes != null) {
      payload.notes = input.notes.trim() ?
        input.notes.trim().slice(0, 400) :
        FieldValue.delete();
    }

    if (input.estimatedGallonsLost != null) {
      payload.estimatedGallonsLost = Math.max(0, Number(input.estimatedGallonsLost));
    } else if (input.estimatedGallonsLost === null) {
      payload.estimatedGallonsLost = FieldValue.delete();
    }

    if (input.severity === "low" || input.severity === "high" || input.severity === "medium") {
      payload.severity = input.severity;
    }

    await ref.update(payload);
    const saved = await ref.get();
    return this.serialize(saved.id, saved.data() ?? {});
  }

  static async delete(businessId: string, downtimeId: string): Promise<void> {
    const ref = this.collection(businessId).doc(downtimeId);
    const existing = await ref.get();
    if (!existing.exists) {
      throw new Error("Downtime record not found");
    }
    await ref.delete();
  }
}
