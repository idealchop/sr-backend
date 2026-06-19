import { db, FieldValue } from "../../config/firebase-admin";

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

export type CreatePlantDowntimeInput = {
  startedAt?: string;
  endedAt?: string;
  reasonCode: PlantDowntimeReason;
  notes?: string;
  estimatedGallonsLost?: number;
  expenseId?: string;
  severity?: "low" | "medium" | "high";
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
  ): Promise<PlantDowntimeRecord> {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (endedAt && endedAt.getTime() <= startedAt.getTime()) {
      throw new Error("Downtime end must be after start");
    }

    const overlap = await this.collection(businessId)
      .where("startedAt", "<=", endedAt ?? startedAt)
      .limit(20)
      .get();
    for (const doc of overlap.docs) {
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

    const doc = {
      startedAt,
      ...(input.endedAt ? { endedAt: new Date(input.endedAt) } : {}),
      reasonCode: input.reasonCode,
      ...(input.notes ? { notes: input.notes.slice(0, 400) } : {}),
      ...(input.estimatedGallonsLost != null ?
        { estimatedGallonsLost: Math.max(0, Number(input.estimatedGallonsLost)) } :
        {}),
      ...(input.expenseId ? { expenseId: input.expenseId } : {}),
      severity: input.severity ?? "medium",
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await this.collection(businessId).add(doc);
    return this.serialize(ref.id, { ...doc, createdAt: startedAt });
  }
}
