import { db, FieldValue } from "../../config/firebase-admin";

export type TankLevelTag = "raw" | "product" | "reject";

export type TankLevelLogRecord = {
  id: string;
  recordedAt: string;
  rawPct?: number;
  productPct?: number;
  rejectPct?: number;
  source: "manual" | "device";
  deviceId?: string;
  notes?: string;
};

export type CreateTankLevelLogInput = {
  recordedAt?: string;
  rawPct?: number;
  productPct?: number;
  rejectPct?: number;
  source?: "manual" | "device";
  deviceId?: string;
  notes?: string;
};

/** MP-14 — manual / IoT tank level logs. */
export class TankLevelLogService {
  static collection(businessId: string) {
    return db.collection("businesses").doc(businessId).collection("tank_level_logs");
  }

  static async list(businessId: string, limit = 30): Promise<TankLevelLogRecord[]> {
    const snap = await this.collection(businessId)
      .orderBy("recordedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      const recordedAt = d.recordedAt?.toDate ?
        d.recordedAt.toDate().toISOString() :
        String(d.recordedAt || "");
      return {
        id: doc.id,
        recordedAt,
        rawPct: d.rawPct != null ? Number(d.rawPct) : undefined,
        productPct: d.productPct != null ? Number(d.productPct) : undefined,
        rejectPct: d.rejectPct != null ? Number(d.rejectPct) : undefined,
        source: d.source === "device" ? "device" : "manual",
        deviceId: d.deviceId ? String(d.deviceId) : undefined,
        notes: d.notes ? String(d.notes) : undefined,
      };
    });
  }

  static async create(
    businessId: string,
    input: CreateTankLevelLogInput,
  ): Promise<TankLevelLogRecord> {
    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
    const doc = {
      recordedAt,
      ...(input.rawPct != null ? { rawPct: clampPct(input.rawPct) } : {}),
      ...(input.productPct != null ? { productPct: clampPct(input.productPct) } : {}),
      ...(input.rejectPct != null ? { rejectPct: clampPct(input.rejectPct) } : {}),
      source: input.source === "device" ? "device" : "manual",
      ...(input.deviceId ? { deviceId: input.deviceId.slice(0, 64) } : {}),
      ...(input.notes ? { notes: input.notes.slice(0, 300) } : {}),
      createdAt: FieldValue.serverTimestamp(),
    };
    const source: "manual" | "device" = input.source === "device" ? "device" : "manual";
    const ref = await this.collection(businessId).add(doc);
    return {
      id: ref.id,
      recordedAt: recordedAt.toISOString(),
      rawPct: doc.rawPct,
      productPct: doc.productPct,
      rejectPct: doc.rejectPct,
      source,
      deviceId: doc.deviceId,
      notes: doc.notes,
    };
  }

  /** MP-23 — latest levels for dashboard. */
  static async latestSnapshot(businessId: string): Promise<TankLevelLogRecord | null> {
    const rows = await this.list(businessId, 1);
    return rows[0] ?? null;
  }
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Number(n) || 0));
}
